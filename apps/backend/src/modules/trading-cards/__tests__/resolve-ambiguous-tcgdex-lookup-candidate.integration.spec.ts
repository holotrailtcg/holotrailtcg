import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260723100000 } from "../migrations/Migration20260723100000"
import { Migration20260723150000 } from "../migrations/Migration20260723150000"
import { Migration20260723160000 } from "../migrations/Migration20260723160000"
import { TCGDEX_ERROR_CODE, TcgDexError } from "../tcgdex/errors"
import type { TcgDexLookupDependency } from "../tcgdex/matching"

let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

function fakeClient(byId: Record<string, unknown | Error>): TcgDexLookupDependency {
  return {
    getCardBySetAndLocalId: async () => null,
    getCardById: async (_language: unknown, tcgdexCardId: string) => {
      const outcome = byId[tcgdexCardId]
      if (outcome instanceof Error) throw outcome
      return outcome ?? null
    },
  }
}

const candidateOptions = [
  { tcgdexCardId: "swsh4pt5-001", localId: "001", name: "Zapdos", image: "https://assets.tcgdex.net/en/swsh/swsh4pt5/001" },
  { tcgdexCardId: "swsh4pt5-001b", localId: "001", name: "Zapdos (alt art)", image: "https://assets.tcgdex.net/en/swsh/swsh4pt5/001b" },
]

const validTcgdexCardResponse = (tcgdexCardId: string) => ({
  id: tcgdexCardId,
  localId: "001",
  name: "Zapdos",
  category: "Pokemon",
  image: "https://assets.tcgdex.net/en/swsh/swsh4pt5/001",
  illustrator: "5ban Graphics",
  rarity: "Rare",
  set: { id: "swsh4pt5", name: "Shining Fates" },
  variants: { normal: true, reverse: true, holo: false, firstEdition: false },
})

async function ambiguousCandidateFixture(overrides: { reviewStatus?: string } = {}) {
  const id = `tclookup_${suffix()}`
  const [row] = (await pgConnection.raw(
    `insert into trading_card_tcgdex_lookup_candidate
       (id, provider, language, tcgdex_set_id, card_number, match_outcome, candidate_options, review_status)
     values (?, 'PULSE', 'EN', ?, '001', 'AMBIGUOUS', ?::jsonb, ?)
     returning *`,
    [id, `swsh4pt5-${suffix()}`, JSON.stringify(candidateOptions), overrides.reviewStatus ?? "PENDING"],
  )).rows
  return row
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  // Same defensive re-apply pattern as retry-tcgdex-lookup-candidate.integration.spec.ts:
  // only the entity_type widening from Migration20260723100000, then the action-list
  // widening from Migration20260723150000, then this feature's own AMBIGUOUS/
  // candidate_options schema from Migration20260723160000 — applied in dependency order.
  const entityTypeMigration = new Migration20260723100000(undefined as never, undefined as never)
  await entityTypeMigration.up()
  for (const query of entityTypeMigration.getQueries().slice(0, 2)) await pgConnection.raw(String(query))
  entityTypeMigration.reset()

  const actionMigration = new Migration20260723150000(undefined as never, undefined as never)
  await actionMigration.up()
  for (const query of actionMigration.getQueries()) await pgConnection.raw(String(query))
  actionMigration.reset()

  const ambiguousMigration = new Migration20260723160000(undefined as never, undefined as never)
  await ambiguousMigration.up()
  for (const query of ambiguousMigration.getQueries()) await pgConnection.raw(String(query))
  ambiguousMigration.reset()

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

jest.setTimeout(30000)

describe("resolveAmbiguousTcgdexLookupCandidate", () => {
  it("promotes the chosen candidate to MATCHED with fresh, full enrichment", async () => {
    const row = await ambiguousCandidateFixture()
    const chosen = candidateOptions[1].tcgdexCardId

    const saved = await cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: chosen,
      client: fakeClient({ [chosen]: validTcgdexCardResponse(chosen) }),
    })

    expect(saved.match_outcome).toBe("MATCHED")
    expect(saved.candidate_options).toBeNull()
    expect(saved.review_status).toBe("PENDING")
    expect(saved.enrichment).toMatchObject({
      provider: "TCGDEX", providerCardId: chosen, illustrator: "5ban Graphics", providerRarity: "Rare",
    })

    const [audit] = (await pgConnection.raw(
      `select * from trading_card_audit_entry where entity_id = ? and action = 'TCGDEX_AMBIGUOUS_CANDIDATE_RESOLVED'`,
      [row.id],
    )).rows
    expect(audit).toBeTruthy()
    expect(audit.new_value).toMatchObject({ matchOutcome: "MATCHED", chosenTcgdexCardId: chosen })
  })

  it("rejects a chosenTcgdexCardId that is not one of the stored candidate options", async () => {
    const row = await ambiguousCandidateFixture()

    await expect(cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: "swsh4pt5-not-an-option",
      client: fakeClient({}),
    })).rejects.toMatchObject({ message: expect.stringMatching(/not one of this candidate's shortlisted options/) })

    const [unchanged] = (await pgConnection.raw(`select * from trading_card_tcgdex_lookup_candidate where id = ?`, [row.id])).rows
    expect(unchanged.match_outcome).toBe("AMBIGUOUS")
  })

  it("rejects a candidate that is not AMBIGUOUS", async () => {
    const id = `tclookup_${suffix()}`
    const [row] = (await pgConnection.raw(
      `insert into trading_card_tcgdex_lookup_candidate (id, provider, language, tcgdex_set_id, card_number, match_outcome)
       values (?, 'PULSE', 'EN', ?, '001', 'NO_MATCH') returning *`,
      [id, `swsh4pt5-${suffix()}`],
    )).rows

    await expect(cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: "swsh4pt5-001",
      client: fakeClient({}),
    })).rejects.toMatchObject({ message: expect.stringMatching(/pending, ambiguous lookup candidate/) })
  })

  it("rejects a candidate that has already been resolved (review_status no longer PENDING)", async () => {
    const row = await ambiguousCandidateFixture({ reviewStatus: "ACCEPTED" })

    await expect(cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: candidateOptions[0].tcgdexCardId,
      client: fakeClient({}),
    })).rejects.toMatchObject({ message: expect.stringMatching(/pending, ambiguous lookup candidate/) })
  })

  it("surfaces a not-found error if the chosen card no longer exists on TCGdex, without mutating the row", async () => {
    const row = await ambiguousCandidateFixture()
    const chosen = candidateOptions[0].tcgdexCardId

    await expect(cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: chosen,
      client: fakeClient({
        [chosen]: new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "not found", operation: "matching-response" }),
      }),
    })).rejects.toMatchObject({ message: expect.stringMatching(/could not be found on TCGdex anymore/) })

    const [unchanged] = (await pgConnection.raw(`select * from trading_card_tcgdex_lookup_candidate where id = ?`, [row.id])).rows
    expect(unchanged.match_outcome).toBe("AMBIGUOUS")
    expect(unchanged.candidate_options).not.toBeNull()
  })

  it("rejects a TCGdex response whose id does not match the chosen card (schema validity alone is not enough)", async () => {
    const row = await ambiguousCandidateFixture()
    const chosen = candidateOptions[0].tcgdexCardId
    const other = candidateOptions[1].tcgdexCardId

    await expect(cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: chosen,
      // A well-formed response, but for a different card than the one requested/chosen.
      client: fakeClient({ [chosen]: validTcgdexCardResponse(other) }),
    })).rejects.toMatchObject({ message: expect.stringMatching(/different card than the one chosen/) })

    const [unchanged] = (await pgConnection.raw(`select * from trading_card_tcgdex_lookup_candidate where id = ?`, [row.id])).rows
    expect(unchanged.match_outcome).toBe("AMBIGUOUS")
  })

  it("rejects a malformed TCGdex response for the chosen card", async () => {
    const row = await ambiguousCandidateFixture()
    const chosen = candidateOptions[0].tcgdexCardId

    await expect(cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: chosen,
      client: fakeClient({ [chosen]: { unexpected: "shape" } }),
    })).rejects.toMatchObject({ message: expect.stringMatching(/unexpected response/) })
  })

  it("rejects a second resolution attempt once the row has already moved to MATCHED", async () => {
    // Exercises the same guard a real concurrent race relies on (`match_outcome !== 'AMBIGUOUS'`
    // after the row lock is acquired) without running two overlapping `transactional()` calls
    // against this file's single shared, uncommitted outer transaction — see the note in
    // select-alternative-tcgdex-match.integration.spec.ts on why that would serialise (hang)
    // rather than exercise real concurrency here.
    const row = await ambiguousCandidateFixture()
    const chosenA = candidateOptions[0].tcgdexCardId
    const chosenB = candidateOptions[1].tcgdexCardId
    const client = fakeClient({ [chosenA]: validTcgdexCardResponse(chosenA), [chosenB]: validTcgdexCardResponse(chosenB) })

    await cards.resolveAmbiguousTcgdexLookupCandidate({ actor: "reviewer-1", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: chosenA, client })

    await expect(cards.resolveAmbiguousTcgdexLookupCandidate({
      actor: "reviewer-2", source: "TCGDEX", candidateId: row.id, chosenTcgdexCardId: chosenB, client,
    })).rejects.toMatchObject({ message: expect.stringMatching(/pending, ambiguous lookup candidate/) })

    const [finalRow] = (await pgConnection.raw(`select * from trading_card_tcgdex_lookup_candidate where id = ?`, [row.id])).rows
    expect(finalRow.match_outcome).toBe("MATCHED")
    expect(finalRow.enrichment.providerCardId).toBe(chosenA)

    const audits = (await pgConnection.raw(
      `select * from trading_card_audit_entry where entity_id = ? and action = 'TCGDEX_AMBIGUOUS_CANDIDATE_RESOLVED'`, [row.id],
    )).rows
    expect(audits).toHaveLength(1)
  })
})
