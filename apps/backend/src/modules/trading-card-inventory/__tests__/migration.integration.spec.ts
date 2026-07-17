import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260716090000 } from "../migrations/Migration20260716090000"
import { Migration20260716150000 } from "../migrations/Migration20260716150000"
import { Migration20260716180000 } from "../migrations/Migration20260716180000"
import { Migration20260716190000 } from "../migrations/Migration20260716190000"

let pgConnection: ReturnType<typeof createPgConnection>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

const migrationQueries = async (direction: "up" | "down") => {
  const migrations = direction === "up"
    ? [
        new Migration20260716090000(undefined as never, undefined as never),
        new Migration20260716150000(undefined as never, undefined as never),
        new Migration20260716180000(undefined as never, undefined as never),
      ]
    : [
        new Migration20260716180000(undefined as never, undefined as never),
        new Migration20260716150000(undefined as never, undefined as never),
        new Migration20260716090000(undefined as never, undefined as never),
      ]
  const queries: string[] = []
  for (const migration of migrations) {
    await migration[direction]()
    queries.push(...migration.getQueries().map(String))
    migration.reset()
  }
  return queries
}

const executeMigration = async (direction: "up" | "down") => {
  for (const query of await migrationQueries(direction)) {
    await pgConnection.raw(query)
  }
}

const tableNames = [
  "trading_card_inventory_source",
  "trading_card_inventory_snapshot",
  "trading_card_inventory_snapshot_entry",
  "trading_card_inventory_holding",
  "trading_card_inventory_proposal",
  "trading_card_inventory_transaction",
  "trading_card_inventory_audit_entry",
]

const catalogSnapshot = async () => ({
  constraints: rows(await pgConnection.raw(`
    select n.nspname as schema_name, c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(?)
    order by 1, 2, 3
  `, [tableNames])),
  indexes: rows(await pgConnection.raw(`
    select schemaname, tablename, indexname, indexdef
    from pg_indexes
    where schemaname = 'public' and tablename = any(?)
    order by 1, 2, 3
  `, [tableNames])),
  tables: rows(await pgConnection.raw(`
    select n.nspname as schema_name, c.relname as relation_name, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = any(?)
    order by 1, 2
  `, [tableNames])),
})

/**
 * This file's migration list intentionally excludes
 * `Migration20260716190000` (the audit-action CHECK-constraint widener that
 * adds the Stage 5B.1 `IMPORT_*` actions — covered separately by
 * `import-audit-action-migration.integration.spec.ts`). Every other suite
 * that performs a real Pulse import (the HTTP integration suite, the Pulse
 * workflow/service module specs) applies that widening and leaves genuine
 * `IMPORT_*` rows in the shared `trading_card_inventory_audit_entry` table
 * behind — there is no per-suite database in this project (Neon-backed,
 * single persistent test database; see docs/decisions/0001). Reapplying
 * this file's own (narrower, pre-widening) `action` CHECK constraint via its
 * `up()` then fails against those rows, even though nothing this suite does
 * is wrong. Truncating only the tables this file's own three migrations
 * create/own, once, before any assertion runs, makes the whole-schema
 * equality assertions below independent of whatever any other suite has
 * already run against this same database — a table-scoped cleanup, not a
 * database reset (see docs/operations/environment-variables.md's "never
 * reset, drop or reseed a database" guidance, which this respects: the
 * tables themselves are untouched, and this file's own `down()` already
 * drops every one of them unconditionally as part of its normal cycle).
 */
async function truncateOwnedTablesIfPresent(): Promise<void> {
  for (const tableName of tableNames) {
    const [{ to_regclass: exists }] = rows(await pgConnection.raw(`select to_regclass('public.${tableName}') as to_regclass`))
    if (exists) await pgConnection.raw(`truncate table "${tableName}" cascade`)
  }
}

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  await truncateOwnedTablesIfPresent()
})

afterAll(async () => {
  // Always leave the schema in the fully-current "up" (applied) state for
  // other test files/module specs that expect these tables to exist —
  // including `Migration20260716190000`'s audit-action CHECK-constraint
  // widening, which this file's own migration list doesn't own or assert on
  // (see `import-audit-action-migration.integration.spec.ts` for that), but
  // whose absence would otherwise leave every sibling suite's real Pulse
  // imports unable to insert their own `IMPORT_*` audit rows after this file
  // runs.
  await executeMigration("up")
  const widenAuditAction = new Migration20260716190000(undefined as never, undefined as never)
  await widenAuditAction.up()
  for (const query of widenAuditAction.getQueries().map(String)) await pgConnection.raw(query)
  widenAuditAction.reset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
})

describe("Stage 5A inventory domain migrations", () => {
  it("supports up/up/down/down/up without leaving unrelated schema objects behind", async () => {
    await executeMigration("up")
    const afterFirstUp = await catalogSnapshot()
    expect(afterFirstUp.tables.map((row) => row.relation_name).sort()).toEqual([...tableNames].sort())

    await executeMigration("up")
    expect(await catalogSnapshot()).toEqual(afterFirstUp)

    await executeMigration("down")
    const afterFirstDown = await catalogSnapshot()
    expect(afterFirstDown.tables).toHaveLength(0)
    expect(afterFirstDown.constraints).toHaveLength(0)
    expect(afterFirstDown.indexes).toHaveLength(0)

    await executeMigration("down")
    expect(await catalogSnapshot()).toEqual(afterFirstDown)

    await executeMigration("up")
    expect(await catalogSnapshot()).toEqual(afterFirstUp)
  }, 60000)

  it("enforces the non-negative-quantity CHECK constraint at the database level", async () => {
    await executeMigration("up")
    const sourceId = `tcisrc_migtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Migration Test Source", `migration test source ${sourceId}`]
    )
    await expect(pgConnection.raw(
      `insert into trading_card_inventory_holding (id, inventory_source_id, trading_card_variant_id, quantity) values (?, ?, ?, -1)`,
      [`tcihold_${Date.now().toString(36)}`, sourceId, `tcvar_${Date.now().toString(36)}`]
    )).rejects.toThrow(/quantity_non_negative|check constraint/i)
    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])
  }, 60000)

  it("rolls the reconciliation migration down without disturbing the Stage 5A.1 tables", async () => {
    await executeMigration("up")
    const migration = new Migration20260716150000(undefined as never, undefined as never)
    await migration.down()
    for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
    const afterDown = await catalogSnapshot()
    expect(afterDown.tables.map((row) => row.relation_name)).not.toContain("trading_card_inventory_snapshot_entry")
    expect(afterDown.tables.map((row) => row.relation_name)).toContain("trading_card_inventory_source")
    migration.reset()
    await migration.up()
    for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
  }, 60000)
})
