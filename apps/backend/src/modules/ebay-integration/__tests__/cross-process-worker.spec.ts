import { randomUUID } from "node:crypto"
import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import { assertTestDatabase } from "../../../utils/assert-test-database"
import { EBAY_INTEGRATION_MODULE } from "../index"
import { encryptRefreshToken } from "../crypto/token-encryption"
import { hashOAuthState } from "../oauth/state"
import { withEbayLifecycleLock } from "../lifecycle-lock"
import { createEbayTokenService } from "../token-service"
import type { EbayEnvironmentConfig } from "../config"
import type { EbayOAuthClient } from "../dependencies"
import {
  CONTROL_MARKER, ensureControlTable, signal, waitForMarker,
} from "./cross-process-control"

const runId = process.env.EBAY_E1_TEST_RUN_ID ?? ""
const role = process.env.EBAY_E1_WORKER_ROLE ?? ""
const scenario = process.env.EBAY_E1_SCENARIO ?? ""
const isWorker = Boolean(runId || role || scenario)

const validRunId = /^[a-f0-9-]{36}$/.test(runId)
const validRole = role === "A" || role === "B"
const validScenario = ["simultaneous", "disconnect", "reconnect"].includes(scenario)
const keyring = { activeVersion: "cross-process-v1", keys: new Map([["cross-process-v1", Buffer.alloc(32, 19)]]) }

describe("Stage E1 isolated Jest worker", () => {
  if (!isWorker) {
    it.skip("runs only when targeted by the cross-process parent", () => undefined)
    return
  }

  let pg: ReturnType<typeof createPgConnection>
  let app: Awaited<ReturnType<typeof MedusaApp>>
  let service: any
  let connectionId = ""

  beforeAll(async () => {
    if (!validRunId || !validRole || !validScenario) throw new Error("Invalid bounded cross-process worker control values.")
    assertTestDatabase(process.env.DATABASE_URL, { requireDatabase: true })
    pg = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
    await ensureControlTable(pg)
    app = await MedusaApp({
      modulesConfig: {
        [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" },
        [Modules.LOCKING]: {
          resolve: "@medusajs/medusa/locking",
          options: { providers: [{
            resolve: "@medusajs/medusa/locking-postgres", id: "locking-postgres", is_default: true,
          }] },
        },
      },
      injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pg },
      cwd: process.cwd(),
    })
    await app.onApplicationStart()
    service = app.modules[EBAY_INTEGRATION_MODULE]
    const result = await pg.raw(
      `select id from ebay_integration_connection where environment = 'SANDBOX' and deleted_at is null`
    )
    connectionId = String((Array.isArray(result) ? result : result.rows)[0]?.id ?? "")
    if (!connectionId) throw new Error("Cross-process fixture connection is missing.")
    const locking = app.sharedContainer!.resolve(Modules.LOCKING)
    await signal(pg, runId, role, CONTROL_MARKER.INSTANCE, JSON.stringify({
      pid: process.pid, service: randomUUID(), provider: randomUUID(), connection: randomUUID(), cache: randomUUID(),
      providerResolved: Boolean(locking),
    }))
  }, 60_000)

  afterAll(async () => {
    if (app) {
      await app.onApplicationPrepareShutdown()
      await app.onApplicationShutdown()
    }
    await (pg as any)?.context?.destroy?.()
    await pg?.destroy()
  })

  it("performs only its assigned deterministic role", async () => {
    await signal(pg, runId, role, role === "A" ? CONTROL_MARKER.READY_A : CONTROL_MARKER.READY_B)
    await waitForMarker(pg, runId, CONTROL_MARKER.RELEASE_START, ["PARENT"])

    if (role === "B" && scenario !== "simultaneous") {
      await waitForMarker(pg, runId, CONTROL_MARKER.REMOTE_REFRESH_REACHED, ["A"])
      if (scenario === "disconnect") {
        const correlationId = randomUUID()
        const completed = await withEbayLifecycleLock({
          container: app.sharedContainer!, environment: "SANDBOX", correlationId,
          actorId: "cross-process-worker",
          work: async () => {
            const prepared = await service.beginDisconnect("SANDBOX")
            return service.completeDisconnect({
              environment: "SANDBOX", connectionId,
              expectedGeneration: prepared.credential?.credentialGeneration ?? null,
              actorId: "cross-process-worker", remotelyRevoked: false, correlationId,
            })
          },
        })
        await signal(pg, runId, role, CONTROL_MARKER.DISCONNECT_COMPLETE, completed?.status ?? "NONE")
      } else {
        const state = `cross-process-state-${runId}`
        const attemptId = randomUUID()
        const correlationId = randomUUID()
        const completed = await withEbayLifecycleLock({
          container: app.sharedContainer!, environment: "SANDBOX", correlationId,
          actorId: "cross-process-worker",
          work: async () => {
            await service.beginConnection({
              environment: "SANDBOX", actorId: "cross-process-worker", attemptId,
              stateHash: hashOAuthState(state), expiresAt: new Date(Date.now() + 60_000),
              reconnect: true, correlationId,
            })
            await service.consumeOAuthState({ stateHash: hashOAuthState(state), environment: "SANDBOX" })
            return service.completeConnection({
              environment: "SANDBOX", actorId: "cross-process-worker", attemptId,
              accountId: "newer-account", displayName: "Newer seller",
              encryptedToken: encryptRefreshToken("newer-refresh-material", keyring), grantedScopes: ["identity"],
              accessTokenExpiresAt: new Date(Date.now() + 3_600_000), correlationId,
            })
          },
        })
        await signal(pg, runId, role, CONTROL_MARKER.RECONNECT_COMPLETE, completed?.credentialGeneration ?? "NONE")
      }
      await signal(pg, runId, role, CONTROL_MARKER.WORKER_COMPLETE)
      return
    }

    let remoteCalls = 0
    const client = {
      refreshUserAccessToken: async () => {
        remoteCalls += 1
        await signal(pg, runId, role, CONTROL_MARKER.REMOTE_REFRESH_REACHED)
        if (scenario !== "simultaneous") await waitForMarker(pg, runId, CONTROL_MARKER.RESUME_REFRESH, ["PARENT"])
        return {
          token: { access_token: `safe-result-${role}`, expires_in: 3600, token_type: "User Access Token" },
          correlationId: randomUUID(),
        }
      },
    } as unknown as EbayOAuthClient
    const tokenService = createEbayTokenService({
      resolveConfig: () => ({ environment: "SANDBOX" } as EbayEnvironmentConfig),
      resolveClient: () => client,
      resolveKeyring: () => keyring,
    })
    let outcome = "ERROR"
    try {
      await tokenService.getAccessToken(app.sharedContainer!, connectionId)
      outcome = "SUCCESS"
    } catch {
      outcome = "REJECTED"
    }
    await signal(pg, runId, role, CONTROL_MARKER.OUTCOME, JSON.stringify({ outcome, remoteCalls }))
    await signal(pg, runId, role, CONTROL_MARKER.WORKER_COMPLETE)
  }, 45_000)
})
