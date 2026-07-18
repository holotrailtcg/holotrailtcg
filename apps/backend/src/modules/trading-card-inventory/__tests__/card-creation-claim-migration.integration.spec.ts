import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260718110000 } from "../migrations/Migration20260718110000"

jest.setTimeout(60000)

let rootConnection: ReturnType<typeof createPgConnection>
let pgConnection: ReturnType<typeof createPgConnection>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

async function run(migration: { up(): Promise<void>; down(): Promise<void>; getQueries(): unknown[]; reset(): void }, direction: "up" | "down") {
  await migration[direction]()
  for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
  migration.reset()
}

const newMigration = () => new Migration20260718110000(undefined as never, undefined as never)

const columnDefinition = async (column: string) => {
  const [row] = rows(await pgConnection.raw(
    `select data_type, is_nullable from information_schema.columns
     where table_name = 'trading_card_inventory_proposal' and column_name = ?`,
    [column],
  ))
  return row as { data_type: string; is_nullable: string } | undefined
}

const constraintDefinition = async (name: string) => {
  const [row] = rows(await pgConnection.raw(
    `select pg_get_constraintdef(oid) as definition from pg_constraint where conname = ?`, [name],
  ))
  return row?.definition as string | undefined
}

// See proposal-application-migration.integration.spec.ts for why an expected
// constraint-violation failure must run inside a SAVEPOINT: a bare failed
// query on the outer per-file transaction poisons it for every later
// statement until rollback.
const expectRawFailure = async (sql: string, params: unknown[], pattern: RegExp) => {
  await expect(pgConnection.transaction((transaction: { raw: (q: string, p?: unknown[]) => Promise<unknown> }) =>
    transaction.raw(sql, params))).rejects.toThrow(pattern)
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = await rootConnection.transaction() as never
})

afterAll(async () => {
  await (pgConnection as unknown as { rollback: () => Promise<void> }).rollback()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (rootConnection as any)?.context?.destroy()
  await rootConnection?.destroy()
})

describe("Stage 5B.3 card-creation claim migration", () => {
  it("adds the two claim columns, cleanly reversible up/up/down/down/up", async () => {
    await run(newMigration(), "up")
    expect(await columnDefinition("card_creation_claim_token")).toMatchObject({ data_type: "text", is_nullable: "YES" })
    expect(await columnDefinition("card_creation_claimed_at")).toMatchObject({ data_type: "timestamp with time zone", is_nullable: "YES" })

    // Idempotent re-run (matches the "if not exists"/"if exists" pattern used throughout this migration).
    await run(newMigration(), "up")
    expect(await columnDefinition("card_creation_claim_token")).toBeDefined()

    await run(newMigration(), "down")
    expect(await columnDefinition("card_creation_claim_token")).toBeUndefined()
    expect(await columnDefinition("card_creation_claimed_at")).toBeUndefined()

    await run(newMigration(), "down")
    expect(await columnDefinition("card_creation_claim_token")).toBeUndefined()

    await run(newMigration(), "up")
    expect(await columnDefinition("card_creation_claim_token")).toBeDefined()
  }, 60000)

  it("widens the audit-action CHECK to accept PROPOSAL_VARIANT_RESOLVED and restores the exact prior definition on down", async () => {
    await run(newMigration(), "down")
    const priorDefinition = await constraintDefinition("trading_card_inventory_audit_entry_action_check")
    expect(priorDefinition).not.toContain("PROPOSAL_VARIANT_RESOLVED")

    await run(newMigration(), "up")
    const widened = await constraintDefinition("trading_card_inventory_audit_entry_action_check")
    expect(widened).toContain("PROPOSAL_VARIANT_RESOLVED")
    // every action the prior constraint accepted must still be accepted (widen-only)
    expect(widened).toContain("PROPOSAL_APPLIED")
    expect(widened).toContain("MEDUSA_SYNC_RETRIED")

    await run(newMigration(), "down")
    const restored = await constraintDefinition("trading_card_inventory_audit_entry_action_check")
    expect(restored).toBe(priorDefinition)

    await run(newMigration(), "up")
  }, 60000)

  it("widens the matched_via CHECK to accept MANUAL and rejects it again once reverted", async () => {
    await run(newMigration(), "up")

    const sourceId = `tcisrc_matchedviamigtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Matched Via Migration Test Source", `matched via migration test source ${sourceId}`],
    )
    const snapshotId = `tcisnap_matchedviamigtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot (id, inventory_source_id, status, sequence_number, created_by)
       values (?, ?, 'DRAFT', 1, 'test-actor')`,
      [snapshotId, sourceId],
    )
    const entryId = `tcisentry_matchedviamigtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry
        (id, inventory_snapshot_id, row_number, provider_reference, provider_reference_type, quantity)
       values (?, ?, 1, 'ref', 'PULSE_PRODUCT_ID', 1)`,
      [entryId, snapshotId],
    )
    const matchId = `tcisematch_matchedviamigtest_${Date.now().toString(36)}`

    // widened: MANUAL is accepted
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry_match
        (id, snapshot_entry_id, inventory_snapshot_id, matching_status, trading_card_variant_id, matched_via)
       values (?, ?, ?, 'MATCHED', 'tcvar_matchedviamigtest', 'MANUAL')`,
      [matchId, entryId, snapshotId],
    )
    await pgConnection.raw(`delete from trading_card_inventory_snapshot_entry_match where id = ?`, [matchId])

    await run(newMigration(), "down")
    await expectRawFailure(
      `insert into trading_card_inventory_snapshot_entry_match
        (id, snapshot_entry_id, inventory_snapshot_id, matching_status, trading_card_variant_id, matched_via)
       values (?, ?, ?, 'MATCHED', 'tcvar_matchedviamigtest', 'MANUAL')`,
      [matchId, entryId, snapshotId],
      /trading_card_inventory_snapshot_entry_match_matched_via_check|check constraint/i,
    )

    await pgConnection.raw(`delete from trading_card_inventory_snapshot_entry where id = ?`, [entryId])
    await pgConnection.raw(`delete from trading_card_inventory_snapshot where id = ?`, [snapshotId])
    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])

    await run(newMigration(), "up")
  }, 60000)
})
