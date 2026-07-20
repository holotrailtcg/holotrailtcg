import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createPgConnection, MedusaError } from "@medusajs/framework/utils"
import { assertTestDatabase } from "../../../utils/assert-test-database"
import { cleanupControlRows, CONTROL_MARKER, CROSS_PROCESS_TIMEOUT_MS, ensureControlTable, readMarkers, signal, waitForMarker } from "./cross-process-control"
import { STALE_MUTATION_TARGET } from "./store-category-cross-process-outcome"

const workerSpec = path.resolve(__dirname, "store-category-cross-process-worker.spec.ts")
const jestExecutable = path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "jest.CMD" : "jest")
type Role = "A" | "B" | "MUTATE" | "IMPORT"
type Marker = Record<string, unknown>
const rows = (value: any): any[] => Array.isArray(value) ? value : value.rows
const idsFor = (runId: string) => ({ root: `e2a1-${runId}-root`, childA: `e2a1-${runId}-child-a`, childB: `e2a1-${runId}-child-b`, unrelated: `e2a1-${runId}-unrelated` })
const actorFor = (runId: string, role: Role) => `e2a1-${runId}-${role}`

describe("E2A1 safe isolated Store-category cross-process concurrency", () => {
  let pg: ReturnType<typeof createPgConnection>; let account = ""; const children = new Set<ChildProcess>()
  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL, { requireDatabase: true })
    pg = createPgConnection({ clientUrl: process.env.DATABASE_URL as string }); await ensureControlTable(pg)
    const connection = rows(await pg.raw("select ebay_account_id from ebay_integration_connection where environment='SANDBOX' and deleted_at is null limit 1"))[0]
    if (!connection?.ebay_account_id) throw new MedusaError(MedusaError.Types.INVALID_DATA, "A pre-existing test Sandbox connection is required.")
    account = String(connection.ebay_account_id)
  })
  afterAll(async () => { for (const child of children) if (child.exitCode === null) child.kill(); await (pg as any)?.context?.destroy?.(); await pg?.destroy() })

  function launch(runId: string, unrelatedExternalId: string, role: Role, scenario = "COMPETING_IMPORTS") {
    const env = { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: "test", NODE_OPTIONS: "--experimental-vm-modules", TEST_TYPE: "integration:modules", DATABASE_URL: process.env.DATABASE_URL, EBAY_E2A1_TEST_RUN_ID: runId, EBAY_E2A1_WORKER_ROLE: role, EBAY_E2A1_SCENARIO: scenario, EBAY_E2A1_UNRELATED_EXTERNAL_ID: unrelatedExternalId }
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe") : jestExecutable
    const args = process.platform === "win32" ? ["/d", "/s", "/c", `${jestExecutable} --runInBand --runTestsByPath ${workerSpec}`] : ["--runInBand", "--runTestsByPath", workerSpec]
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "ignore", windowsHide: true }); children.add(child)
    return { child, done: new Promise<number | null>((resolve) => child.once("close", (code) => { children.delete(child); resolve(code) })) }
  }

  async function activeExternalIds(): Promise<string[]> {
    return rows(await pg.raw("select external_id from ebay_integration_store_category where environment='SANDBOX' and ebay_account_id=? and status='ACTIVE' and deleted_at is null order by external_id", [account])).map((row) => String(row.external_id))
  }

  async function assertPreservedActive(externalIds: string[]): Promise<void> {
    const current = await activeExternalIds()
    for (const externalId of externalIds) expect(current).toContain(externalId)
  }

  async function seedUnrelated(runId: string): Promise<void> {
    const ids = idsFor(runId); const categoryId = `ebstorecat_${runId}_unrelated`; const actorId = `e2a1-${runId}-unrelated`
    await pg.raw(`insert into ebay_integration_store_category (id,environment,ebay_account_id,external_id,name,parent_external_id,sibling_order,level,path,status,source,created_at,updated_at) values (?, 'SANDBOX', ?, ?, ?, null, 99, 1, ?, 'ACTIVE', 'MANUAL', now(), now())`, [categoryId, account, ids.unrelated, `Run ${runId} unrelated`, `Run ${runId} unrelated`])
    await pg.raw(`insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,category_id,correlation_id,details,created_at,updated_at) values (?, 'SANDBOX', ?, ?, 'MANUAL_CREATED', ?, ?, '{}'::jsonb, now(), now())`, [`ebstoreaudit_${runId}_unrelated`, account, actorId, categoryId, `${runId}:unrelated`])
  }

  async function cleanupOwnedRun(runId: string, roles: Role[]): Promise<void> {
    const ids = idsFor(runId); const externalIds = [ids.root, ids.childA, ids.childB]; const actors = roles.map((role) => actorFor(runId, role))
    await pg.raw("delete from ebay_integration_store_category_import_preview where environment='SANDBOX' and ebay_account_id=? and actor_id=any(?::text[])", [account, actors])
    await pg.raw("delete from ebay_integration_store_category_audit where environment='SANDBOX' and ebay_account_id=? and actor_id=any(?::text[])", [account, actors])
    await pg.raw("delete from ebay_integration_store_category where environment='SANDBOX' and ebay_account_id=? and external_id=any(?::text[])", [account, externalIds])
    await cleanupControlRows(pg, runId)
    expect(rows(await pg.raw("select id from ebay_integration_store_category where environment='SANDBOX' and ebay_account_id=? and external_id=any(?::text[])", [account, externalIds]))).toHaveLength(0)
    expect(rows(await pg.raw("select id from ebay_integration_store_category_audit where environment='SANDBOX' and ebay_account_id=? and actor_id=any(?::text[])", [account, actors]))).toHaveLength(0)
    expect(await readMarkers(pg, runId)).toHaveLength(0)
  }

  async function assertAndCleanupUnrelated(runId: string): Promise<void> {
    const ids = idsFor(runId); const actorId = `e2a1-${runId}-unrelated`
    expect(rows(await pg.raw("select status from ebay_integration_store_category where environment='SANDBOX' and ebay_account_id=? and external_id=?", [account, ids.unrelated]))[0]?.status).toBe("ACTIVE")
    expect(rows(await pg.raw("select action from ebay_integration_store_category_audit where environment='SANDBOX' and ebay_account_id=? and actor_id=?", [account, actorId]))[0]?.action).toBe("MANUAL_CREATED")
    await pg.raw("delete from ebay_integration_store_category_audit where environment='SANDBOX' and ebay_account_id=? and actor_id=?", [account, actorId])
    await pg.raw("delete from ebay_integration_store_category where environment='SANDBOX' and ebay_account_id=? and external_id=?", [account, ids.unrelated])
  }

  function assertIndependentWorkers(markers: Marker[], roles: Role[]): void {
    const instances = markers.filter((marker) => marker.marker === CONTROL_MARKER.INSTANCE && roles.includes(String(marker.worker_role) as Role)).map((marker) => JSON.parse(String(marker.value)))
    expect(instances).toHaveLength(roles.length)
    expect(new Set(instances.map((instance) => instance.pid)).size).toBe(roles.length)
    // Service identity: each worker's marker carries an id observed from the
    // actual resolved eBay-integration service instance in that process (see
    // service-instance-identity.ts), not a standalone random label.
    expect(new Set(instances.map((instance) => instance.service)).size).toBe(roles.length)
    // Connection identity: each worker's marker carries pg_backend_pid() as
    // observed from the exact transaction manager that held the category
    // advisory lock during that worker's domain operation.
    const connections = markers.filter((marker) => marker.marker === CONTROL_MARKER.CONNECTION && roles.includes(String(marker.worker_role) as Role)).map((marker) => JSON.parse(String(marker.value)))
    expect(connections).toHaveLength(roles.length)
    expect(connections.every((connection) => Number.isInteger(connection.pid))).toBe(true)
    expect(new Set(connections.map((connection) => connection.pid)).size).toBe(roles.length)
    for (const role of roles) expect(markers.some((marker) => marker.worker_role === role && marker.marker === (role === "A" || role === "MUTATE" ? CONTROL_MARKER.READY_A : CONTROL_MARKER.READY_B))).toBe(true)
  }

  function assertSuccessfulWorkers(markers: Marker[], roles: Role[], exits: Array<number | null>): void {
    expect(exits).toEqual(roles.map(() => 0))
    expect(markers.some((marker) => marker.marker === CONTROL_MARKER.UNEXPECTED_FAILURE || marker.value === "UNEXPECTED_FAILURE")).toBe(false)
    for (const role of roles) {
      expect(markers.some((marker) => marker.worker_role === role && marker.marker === CONTROL_MARKER.WORKER_COMPLETE)).toBe(true)
      expect(markers.some((marker) => marker.worker_role === role && marker.marker === CONTROL_MARKER.OUTCOME && ["SUCCESS", "VALIDATION_REJECTED"].includes(String(marker.value)))).toBe(true)
    }
  }

  function assertHierarchy(active: any[]): void {
    for (const category of active) {
      expect(Number(category.level)).toBeGreaterThanOrEqual(1); expect(Number(category.level)).toBeLessThanOrEqual(3); expect(category.parent_external_id).not.toBe(category.external_id)
      if (category.parent_external_id) { const parent = active.find((candidate) => candidate.external_id === category.parent_external_id); expect(parent).toBeDefined(); expect(Number(category.level)).toBe(Number(parent.level) + 1) }
    }
  }

  it("Scenario A serializes competing complete imports without hybrid data", async () => {
    const runId = randomUUID(); const ids = idsFor(runId); const roles: Role[] = ["A", "B"]
    const preserved = await activeExternalIds(); await seedUnrelated(runId)
    const a = launch(runId, ids.unrelated, "A"), b = launch(runId, ids.unrelated, "B")
    const timer = setTimeout(() => { if (a.child.exitCode === null) a.child.kill(); if (b.child.exitCode === null) b.child.kill() }, CROSS_PROCESS_TIMEOUT_MS + 30_000)
    try {
      await waitForMarker(pg, runId, CONTROL_MARKER.READY_A, ["A"]); await waitForMarker(pg, runId, CONTROL_MARKER.READY_B, ["B"])
      await signal(pg, runId, "PARENT", CONTROL_MARKER.RELEASE_START); await waitForMarker(pg, runId, CONTROL_MARKER.WORKER_COMPLETE, roles)
      const exits = await Promise.all([a.done, b.done]); const markers = await readMarkers(pg, runId)
      assertIndependentWorkers(markers, roles); assertSuccessfulWorkers(markers, roles, exits)
      const outcomes = markers.filter((marker) => marker.marker === CONTROL_MARKER.OUTCOME).map((marker) => String(marker.value)); expect(outcomes).toContain("SUCCESS")
      const active = rows(await pg.raw("select external_id,parent_external_id,level,status from ebay_integration_store_category where environment='SANDBOX' and ebay_account_id=? and status='ACTIVE' order by external_id", [account]))
      const runActive = active.filter((row) => [ids.root, ids.childA, ids.childB, ids.unrelated].includes(row.external_id)); const runActiveIds = runActive.map((row) => row.external_id)
      expect([[ids.childA, ids.root, ids.unrelated].sort(), [ids.childB, ids.root, ids.unrelated].sort()]).toContainEqual(runActiveIds)
      assertHierarchy(active); await assertPreservedActive(preserved)
      const audits = rows(await pg.raw("select details from ebay_integration_store_category_audit where environment='SANDBOX' and ebay_account_id=? and actor_id=any(?::text[])", [account, roles.map((role) => actorFor(runId, role))])); expect(JSON.stringify(audits)).not.toContain("ebay_store_category_id")
    } finally {
      clearTimeout(timer); for (const child of [a.child, b.child]) if (child.exitCode === null) child.kill(); await Promise.allSettled([a.done, b.done]); await cleanupOwnedRun(runId, roles); await assertAndCleanupUnrelated(runId); expect(children.size).toBe(0)
    }
  }, 90_000)

  it("Scenario B serializes mutation versus complete import with an explicit loser", async () => {
    const runId = randomUUID(); const ids = idsFor(runId); const roles: Role[] = ["MUTATE", "IMPORT"]
    const preserved = await activeExternalIds(); await seedUnrelated(runId)
    await pg.raw(`insert into ebay_integration_store_category (id,environment,ebay_account_id,external_id,name,parent_external_id,sibling_order,level,path,status,source,created_at,updated_at) values (?, 'SANDBOX', ?, ?, ?, null, 10, 1, ?, 'ACTIVE', 'MANUAL', now(), now()), (?, 'SANDBOX', ?, ?, ?, ?, 10, 2, ?, 'ACTIVE', 'MANUAL', now(), now())`, [`ebstorecat_${runId}_root`, account, ids.root, `Run ${runId} root`, `Run ${runId} root`, `ebstorecat_${runId}_child`, account, ids.childA, `Run ${runId} child A`, ids.root, `Run ${runId} root / Run ${runId} child A`])
    const mutate = launch(runId, ids.unrelated, "MUTATE", "MUTATION_VS_IMPORT"), imported = launch(runId, ids.unrelated, "IMPORT", "MUTATION_VS_IMPORT")
    const timer = setTimeout(() => { if (mutate.child.exitCode === null) mutate.child.kill(); if (imported.child.exitCode === null) imported.child.kill() }, CROSS_PROCESS_TIMEOUT_MS + 30_000)
    try {
      await waitForMarker(pg, runId, CONTROL_MARKER.READY_A, ["MUTATE"]); await waitForMarker(pg, runId, CONTROL_MARKER.READY_B, ["IMPORT"])
      await signal(pg, runId, "PARENT", CONTROL_MARKER.RELEASE_START); await waitForMarker(pg, runId, CONTROL_MARKER.WORKER_COMPLETE, roles)
      const exits = await Promise.all([mutate.done, imported.done]); const markers = await readMarkers(pg, runId)
      assertIndependentWorkers(markers, roles); assertSuccessfulWorkers(markers, roles, exits)
      const outcomes = Object.fromEntries(markers.filter((marker) => marker.marker === CONTROL_MARKER.OUTCOME).map((marker) => [String(marker.worker_role), String(marker.value)])); expect(outcomes.MUTATE).toMatch(/SUCCESS|VALIDATION_REJECTED/); expect(outcomes.IMPORT).toMatch(/SUCCESS|VALIDATION_REJECTED/); expect(Object.values(outcomes)).toContain("SUCCESS")
      const safeFailureCategories = markers.filter((marker) => marker.marker === CONTROL_MARKER.SAFE_FAILURE_CATEGORY)
      expect(safeFailureCategories.every((marker) => marker.worker_role === "MUTATE" && marker.value === STALE_MUTATION_TARGET)).toBe(true)
      if (safeFailureCategories.some((marker) => marker.value === STALE_MUTATION_TARGET)) {
        expect(safeFailureCategories).toEqual([
          expect.objectContaining({
            worker_role: "MUTATE",
            value: STALE_MUTATION_TARGET,
          }),
        ])
        expect(outcomes.MUTATE).toBe("VALIDATION_REJECTED")
        expect(outcomes.IMPORT).toBe("SUCCESS")
        expect(markers.some((marker) => marker.worker_role === "IMPORT" && marker.marker === CONTROL_MARKER.WORKER_COMPLETE)).toBe(true)
      }
      const active = rows(await pg.raw("select external_id,name,parent_external_id,level,status from ebay_integration_store_category where environment='SANDBOX' and ebay_account_id=? and status='ACTIVE' order by external_id", [account]))
      const runActive = active.filter((row) => [ids.root, ids.childA, ids.childB, ids.unrelated].includes(row.external_id)); const runActiveIds = runActive.map((row) => row.external_id)
      expect([[ids.childA, ids.root, ids.unrelated].sort(), [ids.childB, ids.root, ids.unrelated].sort()]).toContainEqual(runActiveIds)
      if (runActiveIds.includes(ids.childA)) expect(runActive.find((row) => row.external_id === ids.childA)?.name).toBe(`Mutation ${runId}`)
      assertHierarchy(active); await assertPreservedActive(preserved)
    } finally {
      clearTimeout(timer); for (const child of [mutate.child, imported.child]) if (child.exitCode === null) child.kill(); await Promise.allSettled([mutate.done, imported.done]); await cleanupOwnedRun(runId, roles); await assertAndCleanupUnrelated(runId); expect(children.size).toBe(0)
    }
  }, 90_000)

  it("rejects unexpected worker failures and non-zero exits instead of accepting conflict", async () => {
    const runId = randomUUID(); const ids = idsFor(runId); const roles: Role[] = ["A"]
    const preserved = await activeExternalIds(); await seedUnrelated(runId)
    const forced = launch(runId, ids.unrelated, "A", "FORCE_UNEXPECTED_FAILURE")
    const timer = setTimeout(() => { if (forced.child.exitCode === null) forced.child.kill() }, CROSS_PROCESS_TIMEOUT_MS + 30_000)
    try {
      await waitForMarker(pg, runId, CONTROL_MARKER.READY_A, ["A"]); await signal(pg, runId, "PARENT", CONTROL_MARKER.RELEASE_START); await waitForMarker(pg, runId, CONTROL_MARKER.WORKER_COMPLETE, roles)
      const exit = await forced.done; const markers = await readMarkers(pg, runId)
      expect(exit).not.toBe(0); expect(markers.some((marker) => marker.marker === CONTROL_MARKER.UNEXPECTED_FAILURE)).toBe(true); expect(markers.some((marker) => marker.marker === CONTROL_MARKER.OUTCOME && marker.value === "UNEXPECTED_FAILURE")).toBe(true); expect(() => assertSuccessfulWorkers(markers, roles, [exit])).toThrow(); await assertPreservedActive(preserved)
    } finally {
      clearTimeout(timer); if (forced.child.exitCode === null) forced.child.kill(); await Promise.allSettled([forced.done]); await cleanupOwnedRun(runId, roles); await assertAndCleanupUnrelated(runId); expect(children.size).toBe(0)
    }
  }, 90_000)
})
