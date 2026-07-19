import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260714150000 } from "../migrations/Migration20260714150000"

let rootConnection: ReturnType<typeof createPgConnection>
let pgConnection: ReturnType<typeof createPgConnection>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

async function executeMigration(direction: "up" | "down") {
  const migration = new Migration20260714150000(undefined as never, undefined as never)
  await migration[direction]()
  for (const query of migration.getQueries()) await pgConnection.raw(String(query))
  migration.reset()
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  // Codex remediation: this migration's `down()` re-adds
  // `CK_trading_card_audit_entity_type`/`CK_trading_card_audit_action` with
  // their own hardcoded pre-image, pre-TCGdex-widening value lists (it
  // predates both `CARD_IMAGE` entity rows and every `IMAGE_*` action, added
  // by the later Migration20260715120000) — an `ADD CONSTRAINT` is checked
  // against every existing row in the table, not just this file's own
  // fixtures. Real CARD_IMAGE/IMAGE_* audit rows already exist in the shared
  // test database from other, real (committed) exercise of the image
  // feature, so `down()` reliably fails wherever this spec happens to land
  // in a shared `test:integration:modules` run. By the time this suite runs,
  // whole-transaction-per-file isolation (this connection is one uncommitted
  // transaction rolled back in `afterAll`) means reassigning those rows here
  // is fully invisible outside this test — it is never committed, so it can
  // never affect real data — and it must happen before the very first
  // `down()` call.
  pgConnection = await rootConnection.transaction() as never
  await pgConnection.raw(
    `update trading_card_audit_entry set entity_type = 'TRADING_CARD'
     where entity_type not in ('TRADING_CARD', 'TRADING_CARD_VARIANT', 'EXTERNAL_CARD_REFERENCE')`,
  )
  await pgConnection.raw(
    `update trading_card_audit_entry set action = 'CANONICAL_IDENTITY_CHANGED'
     where action not in (
       'CANONICAL_IDENTITY_CHANGED', 'CONDITION_CHANGED', 'FINISH_CHANGED', 'SPECIAL_TREATMENT_CHANGED',
       'PRICE_LOCKED', 'PRICE_UNLOCKED', 'EXTERNAL_REFERENCE_ADDED', 'EXTERNAL_REFERENCE_CHANGED', 'EXTERNAL_REFERENCE_REMOVED'
     )`,
  )
})
afterAll(async () => {
  await (pgConnection as unknown as { rollback: () => Promise<void> }).rollback()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (rootConnection as any)?.context?.destroy()
  await rootConnection?.destroy()
})

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
