import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createPgConnection } from "@medusajs/framework/utils"
import { assertTestDatabase } from "../../../utils/assert-test-database"
import { encryptRefreshToken } from "../crypto/token-encryption"
import {
  cleanupControlRows, CONTROL_MARKER, CROSS_PROCESS_TIMEOUT_MS, ensureControlTable,
  readMarkers, signal, waitForMarker,
} from "./cross-process-control"

const keyring = { activeVersion: "cross-process-v1", keys: new Map([["cross-process-v1", Buffer.alloc(32, 19)]]) }
const workerSpec = path.resolve(__dirname, "cross-process-worker.spec.ts")
const jestExecutable = path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "jest.CMD" : "jest")

type Scenario = "simultaneous" | "disconnect" | "reconnect"
type ChildResult = { role: string; code: number | null; stdout: string; stderr: string }

describe("Stage E1 two-process concurrency", () => {
  let pg: ReturnType<typeof createPgConnection>
  const children = new Set<ChildProcess>()

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL, { requireDatabase: true })
    pg = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
    await ensureControlTable(pg)
  })

  afterAll(async () => {
    for (const child of children) if (child.exitCode === null) child.kill()
    // This table exists only for this dedicated harness. Clear every row so
    // interrupted/manual worker diagnostics cannot leak into a later run.
    await pg.raw(`delete from ebay_e1_test_control`)
    await pg.raw(`delete from ebay_integration_connection_audit`)
    await pg.raw(`delete from ebay_integration_oauth_state`)
    await pg.raw(`delete from ebay_integration_connection`)
    await (pg as any)?.context?.destroy?.()
    await pg?.destroy()
  })

  async function fixture(runId: string): Promise<string> {
    await pg.raw(`delete from ebay_integration_connection_audit`)
    await pg.raw(`delete from ebay_integration_oauth_state`)
    await pg.raw(`delete from ebay_integration_connection`)
    const id = `ebconn_${runId.replaceAll("-", "").slice(0, 20)}`
    const generation = randomUUID()
    const encrypted = encryptRefreshToken("cross-process-refresh-material", keyring)
    await pg.raw(
      `insert into ebay_integration_connection
       (id, environment, status, current_attempt_id, ebay_account_id, display_name,
        credential_generation, refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
        encryption_key_version, granted_scopes, access_token_expires_at, connected_at, last_refresh_at,
        created_at, updated_at)
       values (?, 'SANDBOX', 'CONNECTED', ?, 'fixture-account', 'Fixture seller', ?, ?, ?, ?, ?, '[]'::jsonb,
        now() - interval '1 hour', now(), now(), now(), now())`,
      [id, generation, generation, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion]
    )
    return id
  }

  function launch(runId: string, scenario: Scenario, role: "A" | "B"): {
    child: ChildProcess
    result: Promise<ChildResult>
  } {
    const allowedEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "test",
      NODE_OPTIONS: "--experimental-vm-modules",
      TEST_TYPE: "integration:modules",
      DATABASE_URL: process.env.DATABASE_URL,
      EBAY_E1_TEST_RUN_ID: runId,
      EBAY_E1_WORKER_ROLE: role,
      EBAY_E1_SCENARIO: scenario,
    }
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe") : jestExecutable
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", `${jestExecutable} --runInBand --runTestsByPath ${workerSpec}`]
      : ["--runInBand", "--runTestsByPath", workerSpec]
    const child = spawn(command, args, {
      cwd: process.cwd(), env: allowedEnvironment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    })
    children.add(child)
    let stdout = ""
    let stderr = ""
    child.stdout!.on("data", (chunk) => { stdout += String(chunk) })
    child.stderr!.on("data", (chunk) => { stderr += String(chunk) })
    const result = new Promise<ChildResult>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code) => {
        children.delete(child)
        resolve({ role, code, stdout, stderr })
      })
    })
    return { child, result }
  }

  async function runScenario(scenario: Scenario) {
    const runId = randomUUID()
    const connectionId = await fixture(runId)
    const a = launch(runId, scenario, "A")
    const b = launch(runId, scenario, "B")
    const timeout = setTimeout(() => {
      if (a.child.exitCode === null) a.child.kill()
      if (b.child.exitCode === null) b.child.kill()
    }, CROSS_PROCESS_TIMEOUT_MS + 30_000)
    try {
      await waitForMarker(pg, runId, CONTROL_MARKER.READY_A, ["A"])
      await waitForMarker(pg, runId, CONTROL_MARKER.READY_B, ["B"])
      await signal(pg, runId, "PARENT", CONTROL_MARKER.RELEASE_START)
      if (scenario !== "simultaneous") {
        await waitForMarker(pg, runId, CONTROL_MARKER.REMOTE_REFRESH_REACHED, ["A"])
        await waitForMarker(pg, runId,
          scenario === "disconnect" ? CONTROL_MARKER.DISCONNECT_COMPLETE : CONTROL_MARKER.RECONNECT_COMPLETE,
          ["B"])
        await signal(pg, runId, "PARENT", CONTROL_MARKER.RESUME_REFRESH)
      }
      await waitForMarker(pg, runId, CONTROL_MARKER.WORKER_COMPLETE, ["A", "B"])
      const results = await Promise.all([a.result, b.result])
      const failed = results.filter((result) => result.code !== 0)
      if (failed.length) throw new Error(`Child Jest failure: ${JSON.stringify(failed)}`)
      const markers = await readMarkers(pg, runId)
      const instances = markers.filter((row) => row.marker === CONTROL_MARKER.INSTANCE)
        .map((row) => JSON.parse(String(row.value)))
      expect(instances).toHaveLength(2)
      expect(instances[0].pid).not.toBe(instances[1].pid)
      for (const key of ["service", "provider", "connection", "cache"] as const) {
        expect(instances[0][key]).not.toBe(instances[1][key])
      }
      const outcomes = markers.filter((row) => row.marker === CONTROL_MARKER.OUTCOME)
        .map((row) => JSON.parse(String(row.value)))
      const savedResult = await pg.raw(`select * from ebay_integration_connection where id = ?`, [connectionId])
      const saved = (Array.isArray(savedResult) ? savedResult : savedResult.rows)[0]
      if (scenario === "simultaneous") {
        expect(outcomes.map((item) => item.outcome).sort()).toEqual(["REJECTED", "SUCCESS"])
        expect(outcomes.reduce((sum, item) => sum + item.remoteCalls, 0)).toBe(1)
        expect(saved.status).toBe("CONNECTED")
        expect(saved.refresh_operation_id).toBeNull()
      } else if (scenario === "disconnect") {
        expect(outcomes).toEqual([{ outcome: "REJECTED", remoteCalls: 1 }])
        expect(saved.status).toBe("DISCONNECTED")
        expect(saved.credential_generation).toBeNull()
        expect(saved.refresh_token_ciphertext).toBeNull()
      } else {
        expect(outcomes).toEqual([{ outcome: "REJECTED", remoteCalls: 1 }])
        expect(saved.status).toBe("CONNECTED")
        expect(saved.ebay_account_id).toBe("newer-account")
        expect(saved.refresh_operation_id).toBeNull()
      }
    } catch (error) {
      const diagnostics = await Promise.allSettled([a.result, b.result])
      throw new Error(`${error instanceof Error ? error.message : String(error)}; child diagnostics=${JSON.stringify(diagnostics)}`)
    } finally {
      clearTimeout(timeout)
      for (const child of [a.child, b.child]) if (child.exitCode === null) child.kill()
      await Promise.allSettled([a.result, b.result])
      await cleanupControlRows(pg, runId)
    }
  }

  it("serializes simultaneous refreshes across independent Jest processes", () => runScenario("simultaneous"), 90_000)
  it("rejects refresh completion after a different process disconnects", () => runScenario("disconnect"), 90_000)
  it("rejects stale refresh success and failure after a different process reconnects", () => runScenario("reconnect"), 90_000)
})
