import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260716180000 } from "../migrations/Migration20260716180000"

let pgConnection: ReturnType<typeof createPgConnection>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

const runMigration = async (direction: "up" | "down") => {
  const migration = new Migration20260716180000(undefined as never, undefined as never)
  await migration[direction]()
  for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
  migration.reset()
}

const newTableNames = [
  "trading_card_inventory_snapshot_entry_match",
  "trading_card_inventory_snapshot_entry_diagnostic",
]

const catalogSnapshot = async () => ({
  entryColumns: rows(await pgConnection.raw(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'trading_card_inventory_snapshot_entry'
      and column_name in ('row_number', 'outcome', 'condition_source', 'finish_candidate', 'special_treatment_candidate', 'rarity_candidate', 'rarity_raw', 'language_conflict', 'raw_fields')
    order by column_name
  `)),
  tables: rows(await pgConnection.raw(`
    select c.relname as relation_name from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(?)
    order by 1
  `, [newTableNames])),
  indexes: rows(await pgConnection.raw(`
    select indexname from pg_indexes where schemaname = 'public'
      and (tablename = any(?) or (tablename = 'trading_card_inventory_snapshot_entry' and indexname like 'IDX_tci_snapshot_entry_%'))
    order by indexname
  `, [newTableNames])),
})

beforeAll(() => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
})

afterAll(async () => {
  await runMigration("up")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
})

describe("Stage 5B.1 Pulse import migration", () => {
  it("supports up/up/down/down/up cleanly, adding only the documented columns and tables", async () => {
    await runMigration("up")
    const afterFirstUp = await catalogSnapshot()
    expect(afterFirstUp.entryColumns.map((row) => row.column_name)).toEqual([
      "condition_source", "finish_candidate", "language_conflict", "outcome", "rarity_candidate", "rarity_raw", "raw_fields", "row_number", "special_treatment_candidate",
    ].sort())
    expect(afterFirstUp.tables.map((row) => row.relation_name).sort()).toEqual([...newTableNames].sort())

    await runMigration("up")
    expect(await catalogSnapshot()).toEqual(afterFirstUp)

    await runMigration("down")
    const afterDown = await catalogSnapshot()
    expect(afterDown.entryColumns).toHaveLength(0)
    expect(afterDown.tables).toHaveLength(0)

    await runMigration("down")
    expect(await catalogSnapshot()).toEqual(afterDown)

    await runMigration("up")
    expect(await catalogSnapshot()).toEqual(afterFirstUp)
  }, 60000)

  it("enforces the row_number uniqueness and outcome CHECK constraints at the database level", async () => {
    await runMigration("up")
    const sourceId = `tcisrc_pulsemigtest_${Date.now().toString(36)}`
    const snapshotId = `tcisnap_pulsemigtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Pulse Migration Test Source", `pulse migration test source ${sourceId}`],
    )
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot (id, inventory_source_id, sequence_number, created_by) values (?, ?, 1, 'test')`,
      [snapshotId, sourceId],
    )
    await expect(pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry (id, inventory_snapshot_id, provider_reference, provider_reference_type, quantity, outcome)
       values (?, ?, 'card:test|1', 'PULSE_PRODUCT_ID', 1, 'NOT_A_REAL_OUTCOME')`,
      [`tcisentry_${Date.now().toString(36)}`, snapshotId],
    )).rejects.toThrow(/CK_tci_snapshot_entry_outcome|check constraint/i)

    const entryId1 = `tcisentry_${Date.now().toString(36)}_a`
    const entryId2 = `tcisentry_${Date.now().toString(36)}_b`
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry (id, inventory_snapshot_id, provider_reference, provider_reference_type, quantity, row_number, outcome)
       values (?, ?, 'card:test|1', 'PULSE_PRODUCT_ID', 1, 1, 'VALID')`,
      [entryId1, snapshotId],
    )
    await expect(pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry (id, inventory_snapshot_id, provider_reference, provider_reference_type, quantity, row_number, outcome)
       values (?, ?, 'card:test|2', 'PULSE_PRODUCT_ID', 1, 1, 'VALID')`,
      [entryId2, snapshotId],
    )).rejects.toThrow(/IDX_tci_snapshot_entry_row_number|duplicate key/i)

    await pgConnection.raw(`delete from trading_card_inventory_snapshot_entry where inventory_snapshot_id = ?`, [snapshotId])
    await pgConnection.raw(`delete from trading_card_inventory_snapshot where id = ?`, [snapshotId])
    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])
  }, 60000)
})
