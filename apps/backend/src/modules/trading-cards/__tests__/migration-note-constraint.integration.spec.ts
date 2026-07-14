import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260714120000 } from "../migrations/Migration20260714120000"

let pgConnection: ReturnType<typeof createPgConnection>

const constraintName = "CK_trading_card_external_reference_note_length"
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

const migrationQueries = async (direction: "up" | "down") => {
  const migration = new Migration20260714120000(undefined as never, undefined as never)
  await migration[direction]()
  const queries = [...migration.getQueries()]
  migration.reset()
  return queries.map(String)
}

const executeMigration = async (direction: "up" | "down") => {
  for (const query of await migrationQueries(direction)) {
    await pgConnection.raw(query)
  }
}

const catalogSnapshot = async () => ({
  constraints: rows(await pgConnection.raw(`
    select n.nspname as schema_name, c.relname as table_name, con.conname,
           pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by 1, 2, 3
  `)),
  indexes: rows(await pgConnection.raw(`
    select schemaname, tablename, indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
    order by 1, 2, 3
  `)),
  tables: rows(await pgConnection.raw(`
    select n.nspname as schema_name, c.relname as relation_name, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1, 2
  `)),
})

const withoutTargetConstraint = (snapshot: Awaited<ReturnType<typeof catalogSnapshot>>) => ({
  ...snapshot,
  constraints: snapshot.constraints.filter((row: any) => row.conname !== constraintName),
})

beforeAll(() => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
})

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
})

describe("Stage 3 note-length migration", () => {
  it("supports up/up/down/down/up without changing unrelated schema objects", async () => {
    await executeMigration("down")
    const before = withoutTargetConstraint(await catalogSnapshot())

    await executeMigration("up")
    const afterFirstUp = rows(await pgConnection.raw(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = ?
        and conrelid = 'public.trading_card_external_reference'::regclass
    `, [constraintName]))
    expect(afterFirstUp).toHaveLength(1)
    expect(afterFirstUp[0].definition).toMatch(/length\(raw_payload_note\) <= 500/)

    await executeMigration("up")
    expect(withoutTargetConstraint(await catalogSnapshot())).toEqual(before)
    expect(rows(await pgConnection.raw(`
      select count(*)::int as count
      from pg_constraint
      where conname = ?
        and conrelid = 'public.trading_card_external_reference'::regclass
    `, [constraintName]))).toEqual([{ count: 1 }])

    const cardRows = rows(await pgConnection.raw(`select id from trading_card order by id limit 1`))
    expect(cardRows).toHaveLength(1)
    const referenceId = `migration_note_${Date.now().toString(36)}`
    const baseValues = [referenceId, cardRows[0].id, `migration:${referenceId}`]
    await expect(pgConnection.raw(`
      insert into trading_card_external_reference
        (id, trading_card_id, provider, provider_identifier, raw_payload_note)
      values (?, ?, 'OTHER', ?, ?)
    `, [...baseValues, "x".repeat(501)])).rejects.toThrow(/note_length|check constraint/i)
    await pgConnection.raw(`
      insert into trading_card_external_reference
        (id, trading_card_id, provider, provider_identifier, raw_payload_note)
      values (?, ?, 'OTHER', ?, ?)
    `, [...baseValues, "x".repeat(500)])
    await pgConnection.raw(`delete from trading_card_external_reference where id = ?`, [referenceId])

    await executeMigration("down")
    expect(rows(await pgConnection.raw(`
      select count(*)::int as count
      from pg_constraint
      where conname = ?
        and conrelid = 'public.trading_card_external_reference'::regclass
    `, [constraintName]))).toEqual([{ count: 0 }])
    await executeMigration("down")
    expect(withoutTargetConstraint(await catalogSnapshot())).toEqual(before)

    await executeMigration("up")
    expect(withoutTargetConstraint(await catalogSnapshot())).toEqual(before)
    expect(rows(await pgConnection.raw(`
      select count(*)::int as count
      from pg_constraint
      where conname = ?
        and conrelid = 'public.trading_card_external_reference'::regclass
    `, [constraintName]))).toEqual([{ count: 1 }])
  }, 60000)
})
