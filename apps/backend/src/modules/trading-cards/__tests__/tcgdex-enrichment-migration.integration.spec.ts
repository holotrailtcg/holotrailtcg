import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260714150000 } from "../migrations/Migration20260714150000"

let pgConnection: ReturnType<typeof createPgConnection>
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

async function executeMigration(direction: "up" | "down") {
  const migration = new Migration20260714150000(undefined as never, undefined as never)
  await migration[direction]()
  for (const query of migration.getQueries()) await pgConnection.raw(String(query))
  migration.reset()
}

beforeAll(() => { pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string }) })
afterAll(async () => { await (pgConnection as any)?.context?.destroy(); await pgConnection?.destroy() })

describe("Stage 4A.3 migration", () => {
  it("supports up/up/down/up and preserves Stage 3 cards", async () => {
    const before = rows(await pgConnection.raw(`select count(*)::int as count from trading_card`))[0].count
    const referencesBefore = rows(await pgConnection.raw(`select count(*)::int as count from trading_card_external_reference where trading_card_id is not null`))[0].count
    await executeMigration("up")
    await executeMigration("up")
    expect(rows(await pgConnection.raw(`select to_regclass('public.trading_card_tcgdex_enrichment_proposal') as name`))[0].name).toBe("trading_card_tcgdex_enrichment_proposal")
    expect(rows(await pgConnection.raw(`select to_regclass('public.trading_card_tcgdex_enrichment_attempt') as name`))[0].name).toBe("trading_card_tcgdex_enrichment_attempt")
    expect(rows(await pgConnection.raw(`select count(*)::int as count from pg_constraint where conname = 'CK_tc_reference_owner'`))[0].count).toBe(1)
    expect(rows(await pgConnection.raw(`select count(*)::int as count from pg_constraint where conname = 'CK_tc_reference_variant_owner'`))[0].count).toBe(1)
    expect(rows(await pgConnection.raw(`select count(*)::int as count from pg_indexes where indexname = 'IDX_tcgdex_proposal_one_actionable'`))[0].count).toBe(1)
    await executeMigration("down")
    expect(rows(await pgConnection.raw(`select to_regclass('public.trading_card_tcgdex_enrichment_proposal') as name`))[0].name).toBeNull()
    expect(rows(await pgConnection.raw(`select count(*)::int as count from trading_card`))[0].count).toBe(before)
    expect(rows(await pgConnection.raw(`select count(*)::int as count from trading_card_external_reference where trading_card_id is not null`))[0].count).toBe(referencesBefore)
    await executeMigration("up")
    expect(rows(await pgConnection.raw(`select count(*)::int as count from trading_card`))[0].count).toBe(before)
  }, 60000)
})
