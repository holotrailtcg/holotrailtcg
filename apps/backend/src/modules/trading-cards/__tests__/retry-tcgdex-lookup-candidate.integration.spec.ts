import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260723100000 } from "../migrations/Migration20260723100000"
import type { TcgDexLookupDependency } from "../tcgdex/matching"

/**
 * Stage 1: TCGdex failed-lookup retry. NOT RUN this session — no approved,
 * isolated test database connection was available (see the Stage 1
 * continuation report). Run with `npm run test:integration:modules`
 * against the project's approved test database before merging.
 */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

function fakeClient(outcomes: Array<{ code: string; card?: unknown }>): TcgDexLookupDependency {
  let call = 0
  return {
    getCardBySetAndLocalId: async () => {
      const outcome = outcomes[Math.min(call, outcomes.length - 1)]
      call += 1
      if (outcome.code === "PROVIDER_ERROR") throw new Error("simulated transient TCGdex failure")
      return outcome.card ?? null
    },
    getCardById: async () => null,
  }
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  const migration = new Migration20260723100000(undefined as never, undefined as never)
  await migration.up()
  for (const query of migration.getQueries()) await pgConnection.raw(String(query))
  migration.reset()

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

  it("never caches a PROVIDER_ERROR outcome, leaving the identity retryable again", async () => {
    const setId = `set-${suffix()}`
    const cardNumber = "003"

    await expect(cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "PROVIDER_ERROR" }]),
    })).rejects.toThrow()

    const live = await cards.findTcgdexLookupCandidate({ provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber })
    expect(live).toBeNull()
  })

  it("records a TCGDEX_LOOKUP_RETRIED audit entry", async () => {
    const setId = `set-${suffix()}`
    const cardNumber = "004"
    const result = await cards.retryTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", provider: "PULSE", language: "EN", tcgdexSetId: setId, cardNumber,
      client: fakeClient([{ code: "UNRESOLVED_SET" }]),
    })
    const [audit] = (await pgConnection.raw(
      `select * from trading_card_audit_entry where action = 'TCGDEX_LOOKUP_RETRIED' and entity_id = ? order by created_at desc limit 1`,
      [result.candidate?.id],
    )).rows
    expect(audit).toBeTruthy()
  })
})
