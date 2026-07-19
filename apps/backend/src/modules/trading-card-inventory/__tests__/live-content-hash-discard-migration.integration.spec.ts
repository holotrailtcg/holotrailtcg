import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260717231314 } from "../migrations/Migration20260717231314"
import { Migration20260718150000 } from "../migrations/Migration20260718150000"

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

const newDiscardedStatusMigration = () => new Migration20260717231314(undefined as never, undefined as never)
const newLiveContentHashMigration = () => new Migration20260718150000(undefined as never, undefined as never)

const indexDefinition = async (name: string) => {
  const [row] = rows(await pgConnection.raw(`select indexdef from pg_indexes where indexname = ?`, [name]))
  return row?.indexdef as string | undefined
}

// Mirrors card-creation-claim-migration.integration.spec.ts: an expected
// constraint-violation failure must run inside a SAVEPOINT, otherwise the
// bare failed query poisons the outer per-file transaction for every later
// statement until rollback.
const expectRawFailure = async (sql: string, params: unknown[], pattern: RegExp) => {
  await expect(pgConnection.transaction((transaction: { raw: (q: string, p?: unknown[]) => Promise<unknown> }) =>
    transaction.raw(sql, params))).rejects.toThrow(pattern)
}

// Same SAVEPOINT reasoning, for a migration `down()` whose generated SQL is
// expected to fail partway through.
const expectMigrationFailure = async (
  migration: { down(): Promise<void>; getQueries(): unknown[] },
  pattern: RegExp,
) => {
  await migration.down()
  const queries = migration.getQueries().map(String)
  await expect(pgConnection.transaction(async (transaction: { raw: (q: string) => Promise<unknown> }) => {
    for (const query of queries) await transaction.raw(query)
  })).rejects.toThrow(pattern)
}

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

async function createSource() {
  const id = `tcisrc_lchmigtest_${suffix()}`
  await pgConnection.raw(
    `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
    [id, `Live Content Hash Migration Test Source ${id}`, `live content hash migration test source ${id}`],
  )
  return id
}

async function createSnapshot(sourceId: string, status: string, contentHash: string, sequenceNumber: number) {
  const id = `tcisnap_lchmigtest_${suffix()}`
  const approved = status === "APPLIED"
  await pgConnection.raw(
    `insert into trading_card_inventory_snapshot
      (id, inventory_source_id, status, sequence_number, content_hash, created_by, approved_by, approved_at)
     values (?, ?, ?, ?, ?, 'test-actor', ?, ?)`,
    [id, sourceId, status, sequenceNumber, contentHash, approved ? "test-actor" : null, approved ? new Date() : null],
  )
  return id
}

// Exactly mirrors the predicate `reconcileInventorySnapshot` uses to select
// the latest eligible reconciliation baseline (service.ts, `latestEligibleBaseline`).
async function latestEligibleBaseline(sourceId: string, belowSequenceNumber: number) {
  const [row] = rows(await pgConnection.raw(
    `select * from trading_card_inventory_snapshot
     where inventory_source_id = ? and sequence_number < ? and approved_at is not null
       and status not in ('REJECTED', 'FAILED', 'SUPERSEDED', 'DISCARDED') and deleted_at is null
     order by sequence_number desc limit 1`,
    [sourceId, belowSequenceNumber],
  ))
  return row as { id: string } | undefined
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = await rootConnection.transaction() as never
  // Guarantees DISCARDED is a valid `status` CHECK value regardless of
  // whether this shared test database already has Migration20260717231314
  // applied — idempotent (`if not exists`/`if exists` throughout), so this
  // is safe to run whether the migration is fresh or already committed.
  await run(newDiscardedStatusMigration(), "up")
  // This suite's `down()` tests recreate the pre-widening (narrower) index
  // across the *entire* table, not just this file's own fixtures. Real
  // DISCARDED snapshots may already exist in this shared test database from
  // earlier, real exercise of the discard/re-upload feature — exactly the
  // reuse this migration exists to allow — which would make that narrower
  // index uncreatable for reasons unrelated to what this suite is testing.
  // Since this whole file's connection is one uncommitted transaction rolled
  // back in `afterAll` (see card-creation-claim-migration.integration.spec.ts
  // for the same reasoning), clearing real rows' content_hash here is fully
  // invisible outside this test and can never affect real data.
  await pgConnection.raw(
    `update trading_card_inventory_snapshot set content_hash = null where status = 'DISCARDED' and content_hash is not null`,
  )
})

afterAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (rootConnection as any)?.context?.destroy()
  await rootConnection?.destroy()
})

describe("Stage 5B.3 live-content-hash index migration (Migration20260718150000)", () => {
  it("fresh migration path: creates the widened index excluding DISCARDED", async () => {
    await run(newLiveContentHashMigration(), "up")
    const definition = await indexDefinition("IDX_trading_card_inventory_snapshot_live_content_hash")
    expect(definition).toContain("DISCARDED")
    expect(definition).toContain("REJECTED")
    expect(definition).toContain("FAILED")
  })

  it("upgrade path: starting from the original (717231314-only) index, widens it without dropping data", async () => {
    // Start from the narrower, pre-upgrade predicate (as if only
    // Migration20260717231314 had ever been applied).
    await run(newLiveContentHashMigration(), "down")
    const narrow = await indexDefinition("IDX_trading_card_inventory_snapshot_live_content_hash")
    expect(narrow).not.toContain("DISCARDED")

    await run(newLiveContentHashMigration(), "up")
    const widened = await indexDefinition("IDX_trading_card_inventory_snapshot_live_content_hash")
    expect(widened).toContain("DISCARDED")
    // Widen-only: everything the narrow predicate excluded, the new one still excludes.
    expect(widened).toContain("REJECTED")
    expect(widened).toContain("FAILED")
  })

  it("is idempotent (safe to re-apply up on an already-migrated database)", async () => {
    await run(newLiveContentHashMigration(), "up")
    await run(newLiveContentHashMigration(), "up")
    const definition = await indexDefinition("IDX_trading_card_inventory_snapshot_live_content_hash")
    expect(definition).toContain("DISCARDED")
  })

  it("existing DISCARDED rows: a DISCARDED snapshot and a live snapshot may share a content hash", async () => {
    await run(newLiveContentHashMigration(), "up")
    const sourceId = await createSource()
    const hash = `hash-reupload-${suffix()}`
    await createSnapshot(sourceId, "DISCARDED", hash, 1)
    // Must not throw: the widened index no longer counts the DISCARDED row.
    await createSnapshot(sourceId, "DRAFT", hash, 2)
  })

  it("re-upload of an identical CSV after discard succeeds; an identical still-live CSV is rejected", async () => {
    await run(newLiveContentHashMigration(), "up")
    const sourceId = await createSource()
    const hash = `hash-reupload-live-${suffix()}`

    const firstId = await createSnapshot(sourceId, "DRAFT", hash, 1)
    await pgConnection.raw(`update trading_card_inventory_snapshot set status = 'DISCARDED' where id = ?`, [firstId])

    // Re-upload of the identical (now-discarded) content hash: succeeds.
    await createSnapshot(sourceId, "DRAFT", hash, 2)

    // A second concurrent upload of that same still-live hash: rejected.
    await expectRawFailure(
      `insert into trading_card_inventory_snapshot
        (id, inventory_source_id, status, sequence_number, content_hash, created_by)
       values (?, ?, 'DRAFT', 3, ?, 'test-actor')`,
      [`tcisnap_lchmigtest_${suffix()}`, sourceId, hash],
      /IDX_trading_card_inventory_snapshot_live_content_hash|duplicate key/i,
    )
  })

  it("baseline exclusion: a DISCARDED snapshot is never selected as a reconciliation baseline", async () => {
    await run(newLiveContentHashMigration(), "up")
    const sourceId = await createSource()

    const approvedId = await createSnapshot(sourceId, "APPLIED", `hash-baseline-approved-${suffix()}`, 1)
    const discardedId = await createSnapshot(sourceId, "DISCARDED", `hash-baseline-discarded-${suffix()}`, 2)
    await pgConnection.raw(`update trading_card_inventory_snapshot set approved_by = 'test-actor', approved_at = now() where id = ?`, [discardedId])

    const baseline = await latestEligibleBaseline(sourceId, 3)
    expect(baseline?.id).toBe(approvedId)
    expect(baseline?.id).not.toBe(discardedId)
  })

  it("down() precondition: fails with a unique-constraint violation when a discard-then-reupload reuse exists, and recovers once resolved", async () => {
    await run(newLiveContentHashMigration(), "up")
    const sourceId = await createSource()
    const hash = `hash-down-precondition-${suffix()}`

    await createSnapshot(sourceId, "DISCARDED", hash, 1)
    await createSnapshot(sourceId, "DRAFT", hash, 2) // the reuse this migration exists to allow

    // down() recreates the narrower index, which would once again count the
    // DISCARDED row as "live" — violating uniqueness against the live row
    // sharing its hash. This is the documented rollback precondition.
    await expectMigrationFailure(newLiveContentHashMigration(), /duplicate key|could not create unique index/i)

    // Operator resolution: null out the discarded row's hash so it no longer
    // conflicts. Scoped to this file's own fixtures (id prefix) — earlier
    // tests in this suite ("existing DISCARDED rows", "re-upload of an
    // identical CSV") deliberately created the same kind of reuse, and
    // down() rebuilds the index across the whole table, not just this
    // test's own two rows.
    await pgConnection.raw(
      `update trading_card_inventory_snapshot set content_hash = null
       where status = 'DISCARDED' and content_hash is not null and id like 'tcisnap_lchmigtest_%'`,
    )
    await run(newLiveContentHashMigration(), "down")
    const narrow = await indexDefinition("IDX_trading_card_inventory_snapshot_live_content_hash")
    expect(narrow).not.toContain("DISCARDED")

    await run(newLiveContentHashMigration(), "up")
  })
})
