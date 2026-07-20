import { randomUUID } from "node:crypto"
import { Modules } from "@medusajs/framework/utils"
import { EBAY_OAUTH_CLIENT_KEY } from "../dependencies"
import { EBAY_INTEGRATION_MODULE } from "../index"
import { ebayLifecycleLockKey } from "../lifecycle-lock"
import { encryptRefreshToken, resolveTokenEncryptionKeyring } from "../crypto/token-encryption"
import { createEbayTokenService } from "../token-service"
import { EBAY_E1_SCOPES } from "../types"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("eBay generation-aware access-token lifecycle", () => {
  const original = { ...process.env }

  beforeAll(() => {
    process.env.EBAY_CONNECTIONS_ENABLED = "true"
    process.env.EBAY_SANDBOX_CLIENT_ID = "unit-client"
    process.env.EBAY_SANDBOX_CLIENT_SECRET = "unit-secret"
    process.env.EBAY_SANDBOX_REDIRECT_URI = "unit-runame"
    process.env.EBAY_TOKEN_ENCRYPTION_KEY_VERSION = "unit-v1"
    process.env.EBAY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
  })

  afterAll(() => { process.env = original })

  function fixture() {
    const connectionId = `ebconn_${randomUUID()}`
    const encrypted = encryptRefreshToken("unit-refresh-token", resolveTokenEncryptionKeyring())
    const row: any = {
      connectionId, environment: "SANDBOX", status: "CONNECTED",
      credentialGeneration: randomUUID(), refreshOperationId: null, ...encrypted,
    }
    const queues = new Map<string, Promise<unknown>>()
    const locking = {
      execute: <T>(key: string, work: () => Promise<T>): Promise<T> => {
        const previous = queues.get(key) ?? Promise.resolve()
        const result = previous.catch(() => undefined).then(work)
        queues.set(key, result)
        return result
      },
    }
    const service = {
      retrieveEnvironmentForConnection: jest.fn(async () => row.environment),
      retrieveStoredCredential: jest.fn(async () => ({ ...row })),
      prepareCredentialRefresh: jest.fn(async ({ operationId }: { operationId: string }) => {
        if (row.status !== "CONNECTED" && row.status !== "DEGRADED") throw new Error("not connected")
        if (row.refreshOperationId) throw new Error("already refreshing")
        row.refreshOperationId = operationId
        return { ...row }
      }),
      recordRefreshSuccess: jest.fn(async ({ expectedGeneration, operationId }: any) => {
        if (row.status !== "CONNECTED" || row.credentialGeneration !== expectedGeneration ||
            row.refreshOperationId !== operationId) return false
        row.refreshOperationId = null
        return true
      }),
      recordRefreshFailure: jest.fn(async ({ expectedGeneration, operationId, category }: any) => {
        if (row.credentialGeneration !== expectedGeneration || row.refreshOperationId !== operationId) return false
        row.refreshOperationId = null
        row.status = category === "REFRESH_REQUIRED" ? "REFRESH_REQUIRED" : "DEGRADED"
        return true
      }),
      recordLifecycleLockFailure: jest.fn(async () => undefined),
    }
    const refreshStarted = deferred<void>()
    let refreshGate: Promise<void> | null = null
    const client = {
      refreshCalls: 0,
      refreshUserAccessToken: jest.fn(async () => {
        client.refreshCalls += 1
        refreshStarted.resolve()
        if (refreshGate) await refreshGate
        return {
          token: { access_token: "unit-access-token", expires_in: 3600, token_type: "User Access Token" as const },
          correlationId: "unit",
        }
      }),
    }
    const container = {
      resolve: (key: string) => {
        if (key === Modules.LOCKING) return locking
        if (key === EBAY_INTEGRATION_MODULE) return service
        if (key === EBAY_OAUTH_CLIENT_KEY) return client
        throw new Error(`Unexpected dependency: ${key}`)
      },
    }
    return {
      connectionId, row, locking, service, client, container: container as never, refreshStarted,
      pauseRefresh() {
        const gate = deferred<void>()
        refreshGate = gate.promise
        return gate
      },
    }
  }

  it("prevents two independent token-service caches from refreshing one generation concurrently", async () => {
    const app = fixture()
    const gate = app.pauseRefresh()
    const firstService = createEbayTokenService()
    const secondService = createEbayTokenService()
    const first = firstService.getAccessToken(app.container, app.connectionId)
    await app.refreshStarted.promise
    await expect(secondService.getAccessToken(app.container, app.connectionId)).rejects.toThrow("already refreshing")
    gate.resolve()
    await expect(first).resolves.toBe("unit-access-token")
    expect(app.client.refreshCalls).toBe(1)
    expect(app.service.recordRefreshSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ grantedScopes: [...EBAY_E1_SCOPES] })
    )
  })

  it("does not persist, cache, or return a refresh response after disconnect completes", async () => {
    const app = fixture()
    const responseReceived = deferred<void>()
    const persistenceGate = deferred<void>()
    const tokenService = createEbayTokenService({
      afterRefreshResponse: async () => {
        responseReceived.resolve()
        await persistenceGate.promise
      },
    })
    const refresh = tokenService.getAccessToken(app.container, app.connectionId)
    await responseReceived.promise
    await app.locking.execute(ebayLifecycleLockKey("SANDBOX"), async () => {
      tokenService.invalidateEnvironment("SANDBOX")
      app.row.status = "DISCONNECTED"
      app.row.credentialGeneration = null
      app.row.refreshOperationId = null
    })
    persistenceGate.resolve()
    await expect(refresh).rejects.toThrow("changed while its token was refreshing")
    expect(app.service.recordRefreshSuccess).toHaveBeenCalledTimes(1)
    expect(app.row.status).toBe("DISCONNECTED")
    await expect(tokenService.getAccessToken(app.container, app.connectionId)).rejects.toThrow("requires renewed authorisation")
  })

  it("invalidates a cached token on disconnect and reconnect generation changes", async () => {
    const app = fixture()
    const tokenService = createEbayTokenService()
    await expect(tokenService.getAccessToken(app.container, app.connectionId)).resolves.toBe("unit-access-token")
    expect(app.client.refreshCalls).toBe(1)

    await app.locking.execute(ebayLifecycleLockKey("SANDBOX"), async () => {
      tokenService.invalidateEnvironment("SANDBOX")
      app.row.status = "DISCONNECTED"
      app.row.credentialGeneration = null
    })
    await expect(tokenService.getAccessToken(app.container, app.connectionId)).rejects.toThrow()

    app.row.status = "CONNECTING"
    app.row.credentialGeneration = randomUUID()
    tokenService.invalidateEnvironment("SANDBOX")
    await expect(tokenService.getAccessToken(app.container, app.connectionId)).rejects.toThrow()
    expect(app.client.refreshCalls).toBe(1)
  })
})
