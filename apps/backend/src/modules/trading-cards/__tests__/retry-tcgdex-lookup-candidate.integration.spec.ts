import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { TCGDEX_ERROR_CODE, TcgDexError } from "../tcgdex/errors"
import type { TcgDexLookupDependency } from "../tcgdex/matching"

/** Stage 1: TCGdex failed-lookup retry against the isolated test database. */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

/**
 * `matchTcgdexCard` only converts a thrown `TcgDexError` into a structured
 * PROVIDER_ERROR result — any other thrown value propagates unchanged (see
 * `matchTcgdexCard`'s catch block, which rethrows when
 * `!(error instanceof TcgDexError)`). A plain `Error` here would therefore
 * make `retryTcgdexLookupCandidate` reject instead of resolving with
 * `{ code: "PROVIDER_ERROR", ... }`, which is exactly the behaviour these
 * tests exist to prove — so every simulated provider failure must throw a
 * real `TcgDexError` with an explicit `providerErrorCode`.
 */
function fakeClient(outcomes: Array<{ code: string; card?: unknown; providerErrorCode?: string }>): TcgDexLookupDependency {
  let call = 0
  return {
    getCardBySetAndLocalId: async () => {
      const outcome = outcomes[Math.min(call, outcomes.length - 1)]
      call += 1
      if (outcome.code === "PROVIDER_ERROR") {
        throw new TcgDexError({
          code: (outcome.providerErrorCode as never) ?? TCGDEX_ERROR_CODE.SERVER_ERROR,
          message: "simulated transient TCGdex failure",
          operation: "matching-response",
        })
      }
      if (outcome.code === "NO_MATCH") {
        throw new TcgDexError({
          code: TCGDEX_ERROR_CODE.NOT_FOUND,
          message: "simulated stable TCGdex miss",
          operation: "matching-response",
        })
      }
      return outcome.card ?? null
    },
    getCardById: async () => null,
  }
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

describe("retryTcgdexLookupCandidate", () => {
  it("bypasses a cached NO_MATCH result and persists the fresh outcome", async () => {
    const setId = `set-${suffix()}`
    const cardNumber = "001"
    await cards.recordTcgdexLookupCandidate({ provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber, matchOutcome: "NO_MATCH" })

    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "NO_MATCH" }]),
    })

    expect(result.retried).toBe(true)
    expect(result.code).toBe("NO_MATCH")
    // the old row must be soft-deleted, not left as a live duplicate
    const live = await cards.findTcgdexLookupCandidate({ provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber })
    expect(live?.id).toBe(result.candidate?.id)
  })

  it("is idempotent after a successful match: returns the existing MATCHED row without a new provider call", async () => {
    const setId = `set-${suffix()}`
    const cardNumber = "002"
    await cards.recordTcgdexLookupCandidate({
      provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber, matchOutcome: "MATCHED",
      enrichment: { name: "Pikachu" },
    })

    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "MATCHED" }]),
    })

    expect(result.retried).toBe(false)
    expect(result.code).toBe("MATCHED")
  })

  it("never caches a PROVIDER_ERROR outcome, and leaves no candidate behind when there was nothing cached before", async () => {
    const setId = `set-${suffix()}`
    const cardNumber = "003"

    // matchTcgdexCard converts a thrown client error into a structured PROVIDER_ERROR
    // *result* (see tcgdex/matching.ts) — the retry resolves, it does not throw.
    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "PROVIDER_ERROR" }]),
    })

    expect(result.code).toBe("PROVIDER_ERROR")
    expect(result.providerCode).toBe("SERVER_ERROR")
    expect(result.candidate).toBeNull()
    const live = await cards.findTcgdexLookupCandidate({ provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber })
    expect(live).toBeNull()
  })

  it("preserves the previously cached stable failure when a retry hits a transient PROVIDER_ERROR", async () => {
    const setId = `set-${suffix()}`
    const cardNumber = "003b"
    await cards.recordTcgdexLookupCandidate({ provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber, matchOutcome: "NO_MATCH" })
    const before = await cards.findTcgdexLookupCandidate({ provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber })

    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "PROVIDER_ERROR" }]),
    })

    expect(result.code).toBe("PROVIDER_ERROR")
    // The prior NO_MATCH row must survive untouched — a transient provider failure must never
    // erase a genuine, previously-confirmed stable outcome.
    const after = await cards.findTcgdexLookupCandidate({ provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber })
    expect(after?.id).toBe(before?.id)
    expect(after?.match_outcome).toBe("NO_MATCH")
  })

  it("preserves the specific TIMEOUT subtype separately from other provider failures", async () => {
    // Stage 1 remediation: the Admin UI must be able to show "TCGdex timed
    // out" distinctly from a generic "could not be reached" message —
    // `providerCode` is how that subtype survives from `matchTcgdexCard`
    // through to the API response.
    const setId = `set-${suffix()}`
    const cardNumber = "003c"

    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "PROVIDER_ERROR", providerErrorCode: "TIMEOUT" }]),
    })

    expect(result.code).toBe("PROVIDER_ERROR")
    expect(result.providerCode).toBe("TIMEOUT")
  })

  it("never calls the TCGdex client at all when a MATCHED row is already cached", async () => {
    // The TCGdex network call now runs outside any DB transaction/lock (see
    // the "must never run while holding a transaction" note on
    // `retryTcgdexLookupCandidate`) — the cheap pre-check that skips it
    // entirely for an already-MATCHED identity must still run first.
    const setId = `set-${suffix()}`
    const cardNumber = "003d"
    await cards.recordTcgdexLookupCandidate({
      provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber, matchOutcome: "MATCHED",
      enrichment: { name: "Pikachu" },
    })
    let clientCalled = false
    const client: TcgDexLookupDependency = {
      getCardBySetAndLocalId: async () => { clientCalled = true; return null },
      getCardById: async () => null,
    }

    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber, client,
    })

    expect(result.code).toBe("MATCHED")
    expect(result.retried).toBe(false)
    expect(clientCalled).toBe(false)
  })

  it("records a TCGDEX_LOOKUP_RETRIED audit entry", async () => {
    const setId = `set-${suffix()}`
    const cardNumber = "004"
    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "NO_MATCH" }]),
    })
    const [audit] = (await pgConnection.raw(
      `select * from trading_card_audit_entry where action = 'TCGDEX_LOOKUP_RETRIED' and entity_id = ? order by created_at desc limit 1`,
      [result.candidate?.id],
    )).rows
    expect(audit).toBeTruthy()
  })
})
