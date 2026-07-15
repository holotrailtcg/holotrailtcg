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
    const readyColumns = `(id, trading_card_variant_id, status, final_object_key, original_filename,
      declared_mime_type, declared_byte_size, confirmed_mime_type, confirmed_byte_size,
      width, height, sha256_hash, sort_order, uploaded_by)`
    const readyValuesSql = `(?, ?, 'READY', ?, 'card.jpg', 'image/jpeg', 1024, 'image/jpeg', 1024, 100, 100, ?, 0, 'migration-test-admin')`
    const imageId = `tcimg_migration_${Date.now().toString(36)}`
    await pgConnection.raw(`
      insert into trading_card_image ${readyColumns}
      values ${readyValuesSql}
    `, [imageId, variant.id, `card-images/${variant.id}/${imageId}/aaaa.jpg`, "a".repeat(64)])
    await expect(pgConnection.raw(`
      insert into trading_card_image ${readyColumns}
      values (?, ?, 'READY', ?, 'card2.jpg', 'image/jpeg', 2048, 'image/jpeg', 2048, 100, 100, ?, 0, 'migration-test-admin')
    `, [`${imageId}_dup`, variant.id, `card-images/${variant.id}/${imageId}_dup/bbbb.jpg`, "b".repeat(64)]))
      .rejects.toThrow(/IDX_trading_card_image_ready_sort_order|duplicate key/i)
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

  describe("CK_trading_card_image_lifecycle_keys", () => {
    let variantId: string

    beforeAll(async () => {
      // Idempotent re-application: guarantees the table/constraint exist
      // regardless of ordering against the up/down cycle test above.
      await executeMigration("up")
      const [variant] = rows(await pgConnection.raw(`select id from trading_card_variant order by id limit 1`))
      expect(variant).toBeDefined()
      variantId = variant.id
    })

    const baseColumns = [
      "id", "trading_card_variant_id", "status", "staging_object_key", "final_object_key",
      "original_filename", "declared_mime_type", "declared_byte_size",
      "confirmed_mime_type", "confirmed_byte_size", "width", "height", "sha256_hash",
      "sort_order", "uploaded_by", "archived_at", "archived_by",
    ]

    async function insertRow(id: string, overrides: Record<string, unknown>) {
      const defaults: Record<string, unknown> = {
        id, trading_card_variant_id: variantId, status: "PENDING",
        staging_object_key: `staging/card-images/${variantId}/${id}/${id}.jpg`, final_object_key: null,
        original_filename: "card.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 1024,
        confirmed_mime_type: null, confirmed_byte_size: null, width: null, height: null, sha256_hash: null,
        sort_order: 0, uploaded_by: "lifecycle-test-admin", archived_at: null, archived_by: null,
        ...overrides,
      }
      const columns = baseColumns
      const placeholders = columns.map(() => "?").join(", ")
      return pgConnection.raw(
        `insert into trading_card_image (${columns.join(", ")}) values (${placeholders})`,
        columns.map((column) => defaults[column]) as any[]
      )
    }

    const readyMetadata = (id: string) => ({
      staging_object_key: null,
      final_object_key: `card-images/${variantId}/${id}/final.jpg`,
      confirmed_mime_type: "image/jpeg", confirmed_byte_size: 2048, width: 640, height: 890,
      sha256_hash: "c".repeat(64),
    })

    it("rejects a PENDING row with a final_object_key set", async () => {
      const id = `tcimg_lc_${suffixOf("pending-final")}`
      await expect(insertRow(id, { status: "PENDING", final_object_key: "card-images/x/y/z.jpg" }))
        .rejects.toThrow(/CK_trading_card_image_lifecycle_keys/)
    })

    it("rejects a PENDING row that already carries confirmed metadata", async () => {
      const id = `tcimg_lc_${suffixOf("pending-metadata")}`
      await expect(insertRow(id, { status: "PENDING", confirmed_mime_type: "image/jpeg" }))
        .rejects.toThrow(/CK_trading_card_image_lifecycle_keys/)
    })

    it("rejects a READY row with a null sha256_hash", async () => {
      const id = `tcimg_lc_${suffixOf("ready-null-hash")}`
      const metadata = readyMetadata(id)
      await expect(insertRow(id, { status: "READY", ...metadata, sha256_hash: null }))
        .rejects.toThrow(/CK_trading_card_image_lifecycle_keys/)
    })

    it("rejects a READY row that still carries a staging_object_key", async () => {
      const id = `tcimg_lc_${suffixOf("ready-staging")}`
      const metadata = readyMetadata(id)
      await expect(insertRow(id, {
        status: "READY", ...metadata, staging_object_key: `staging/card-images/${variantId}/${id}/x.jpg`,
      })).rejects.toThrow(/CK_trading_card_image_lifecycle_keys/)
    })

    it("rejects an ARCHIVED row missing archived_by", async () => {
      const id = `tcimg_lc_${suffixOf("archived-missing-by")}`
      const metadata = readyMetadata(id)
      await expect(insertRow(id, {
        status: "ARCHIVED", ...metadata, archived_at: new Date().toISOString(), archived_by: null,
      })).rejects.toThrow(/CK_trading_card_image_archived_consistency/)
    })

    it("rejects an ARCHIVED row missing confirmed metadata", async () => {
      const id = `tcimg_lc_${suffixOf("archived-missing-metadata")}`
      await expect(insertRow(id, {
        status: "ARCHIVED", final_object_key: `card-images/${variantId}/${id}/final.jpg`,
        archived_at: new Date().toISOString(), archived_by: "lifecycle-test-admin",
      })).rejects.toThrow(/CK_trading_card_image_lifecycle_keys/)
    })

    it("rejects a DUPLICATE row that retains a staging_object_key", async () => {
      const id = `tcimg_lc_${suffixOf("duplicate-staging")}`
      await expect(insertRow(id, { status: "DUPLICATE" }))
        .rejects.toThrow(/CK_trading_card_image_lifecycle_keys/)
    })

    it("accepts a well-formed row for every lifecycle status", async () => {
      const pendingId = `tcimg_lc_${suffixOf("ok-pending")}`
      await insertRow(pendingId, { status: "PENDING" })

      const readyId = `tcimg_lc_${suffixOf("ok-ready")}`
      await insertRow(readyId, { status: "READY", ...readyMetadata(readyId), sort_order: 1 })

      const archivedId = `tcimg_lc_${suffixOf("ok-archived")}`
      await insertRow(archivedId, {
        status: "ARCHIVED", ...readyMetadata(archivedId),
        archived_at: new Date().toISOString(), archived_by: "lifecycle-test-admin",
      })

      for (const status of ["DUPLICATE", "REJECTED", "EXPIRED"] as const) {
        const id = `tcimg_lc_${suffixOf(`ok-${status.toLowerCase()}`)}`
        await insertRow(id, { status, staging_object_key: null })
      }

      await pgConnection.raw(`delete from trading_card_image where id like 'tcimg_lc_%'`)
    })
  })
})

function suffixOf(label: string): string {
  return `${label}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
