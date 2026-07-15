import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260715120000 } from "../migrations/Migration20260715120000"

let pgConnection: ReturnType<typeof createPgConnection>

const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

const migrationQueries = async (direction: "up" | "down") => {
  const migration = new Migration20260715120000(undefined as never, undefined as never)
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
  // The two named audit checks are asserted separately (they intentionally
  // widen); every other constraint, index, and table must be untouched.
  constraints: rows(await pgConnection.raw(`
    select n.nspname as schema_name, c.relname as table_name, con.conname,
           pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname <> 'trading_card_image'
      and con.conname not in ('CK_trading_card_audit_entity_type', 'CK_trading_card_audit_action')
    order by 1, 2, 3
  `)),
  indexes: rows(await pgConnection.raw(`
    select schemaname, tablename, indexname, indexdef
    from pg_indexes
    where schemaname = 'public' and tablename <> 'trading_card_image'
    order by 1, 2, 3
  `)),
  tables: rows(await pgConnection.raw(`
    select n.nspname as schema_name, c.relname as relation_name, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'trading_card_image'
    order by 1, 2
  `)),
})

const auditCheckDefinitions = async () => rows(await pgConnection.raw(`
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.trading_card_audit_entry'::regclass
    and conname in ('CK_trading_card_audit_entity_type', 'CK_trading_card_audit_action')
  order by conname
`))

beforeAll(() => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
})

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
})

describe("Stage 4B.1 card-image migration", () => {
  it("supports up/up/down/down/up, widens the audit checks, and preserves existing data", async () => {
    await executeMigration("down")
    const before = await catalogSnapshot()
    const auditChecksBefore = await auditCheckDefinitions()
    const existingCardCount = rows(await pgConnection.raw(`select count(*)::int as count from trading_card`))[0].count
    const existingVariantCount = rows(await pgConnection.raw(`select count(*)::int as count from trading_card_variant`))[0].count

    await executeMigration("up")
    expect(rows(await pgConnection.raw(`select to_regclass('public.trading_card_image') as reg`))[0].reg).toBe("trading_card_image")
    expect(await catalogSnapshot()).toEqual(before)
    const auditChecksAfterFirstUp = await auditCheckDefinitions()
    expect(auditChecksAfterFirstUp.find((row: any) => row.conname === "CK_trading_card_audit_entity_type").definition)
      .toMatch(/CARD_IMAGE/)
    expect(auditChecksAfterFirstUp.find((row: any) => row.conname === "CK_trading_card_audit_action").definition)
      .toMatch(/IMAGE_ARCHIVED/)

    await executeMigration("up")
    expect(await catalogSnapshot()).toEqual(before)
    expect(await auditCheckDefinitions()).toEqual(auditChecksAfterFirstUp)

    expect(rows(await pgConnection.raw(`select count(*)::int as count from trading_card`))[0].count).toBe(existingCardCount)
    expect(rows(await pgConnection.raw(`select count(*)::int as count from trading_card_variant`))[0].count)
      .toBe(existingVariantCount)

    const [variant] = rows(await pgConnection.raw(`select id from trading_card_variant order by id limit 1`))
    expect(variant).toBeDefined()
    const imageId = `tcimg_migration_${Date.now().toString(36)}`
    await pgConnection.raw(`
      insert into trading_card_image
        (id, trading_card_variant_id, status, original_filename, declared_mime_type, declared_byte_size, sort_order, uploaded_by)
      values (?, ?, 'READY', 'card.jpg', 'image/jpeg', 1024, 0, 'migration-test-admin')
    `, [imageId, variant.id])
    await expect(pgConnection.raw(`
      insert into trading_card_image
        (id, trading_card_variant_id, status, original_filename, declared_mime_type, declared_byte_size, sort_order, uploaded_by)
      values (?, ?, 'READY', 'card2.jpg', 'image/jpeg', 2048, 0, 'migration-test-admin')
    `, [`${imageId}_dup`, variant.id])).rejects.toThrow(/IDX_trading_card_image_ready_sort_order|duplicate key/i)
    await pgConnection.raw(`delete from trading_card_image where id = ?`, [imageId])

    await executeMigration("down")
    expect(rows(await pgConnection.raw(`select to_regclass('public.trading_card_image') as reg`))[0].reg).toBeNull()
    expect(await catalogSnapshot()).toEqual(before)
    const auditChecksAfterDown = await auditCheckDefinitions()
    expect(auditChecksAfterDown).toEqual(auditChecksBefore)
    expect(auditChecksAfterDown.find((row: any) => row.conname === "CK_trading_card_audit_entity_type").definition)
      .not.toMatch(/CARD_IMAGE/)
    expect(auditChecksAfterDown.find((row: any) => row.conname === "CK_trading_card_audit_action").definition)
      .not.toMatch(/IMAGE_ARCHIVED/)

    await executeMigration("down")
    expect(await catalogSnapshot()).toEqual(before)
    expect(await auditCheckDefinitions()).toEqual(auditChecksBefore)

    await executeMigration("up")
    expect(await catalogSnapshot()).toEqual(before)
    expect(rows(await pgConnection.raw(`select to_regclass('public.trading_card_image') as reg`))[0].reg).toBe("trading_card_image")
  }, 60000)
})
