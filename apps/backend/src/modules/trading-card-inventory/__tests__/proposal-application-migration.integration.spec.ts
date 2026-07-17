import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260716090000 } from "../migrations/Migration20260716090000"
import { Migration20260716150000 } from "../migrations/Migration20260716150000"
import { Migration20260716180000 } from "../migrations/Migration20260716180000"
import { Migration20260717100000 } from "../migrations/Migration20260717100000"
import { Migration20260718090000 } from "../migrations/Migration20260718090000"
import { Migration20260718090500 } from "../migrations/Migration20260718090500"
import { Migration20260718100000 } from "../migrations/Migration20260718100000"
import { Migration20260718100500 } from "../migrations/Migration20260718100500"

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

const runSchemaMigration = async (direction: "up" | "down") => {
  const migrations = [
    new Migration20260718090000(undefined as never, undefined as never),
    new Migration20260718100500(undefined as never, undefined as never),
  ]
  for (const migration of direction === "up" ? migrations : migrations.reverse()) await run(migration, direction)
}

const runAuditActionMigrations = async (direction: "up" | "down") => {
  const migrations = [
    new Migration20260718090500(undefined as never, undefined as never),
    new Migration20260718100000(undefined as never, undefined as never),
  ]
  for (const migration of direction === "up" ? migrations : migrations.reverse()) await run(migration, direction)
}

const columnDefinition = async (column: string) => {
  const [row] = rows(await pgConnection.raw(
    `select data_type, is_nullable, column_default from information_schema.columns
     where table_name = 'trading_card_inventory_proposal' and column_name = ?`,
    [column],
  ))
  return row as { data_type: string; is_nullable: string; column_default: string | null } | undefined
}

const constraintDefinition = async (name: string) => {
  const [row] = rows(await pgConnection.raw(
    `select pg_get_constraintdef(oid) as definition from pg_constraint where conname = ?`, [name],
  ))
  return row?.definition as string | undefined
}

const auditActionConstraintDefinition = async () => {
  const [row] = rows(await pgConnection.raw(
    `select pg_get_constraintdef(oid) as definition from pg_constraint
     where conname = 'trading_card_inventory_audit_entry_action_check'`,
  ))
  return row?.definition as string | undefined
}

// Runs `sql` inside a SAVEPOINT (a nested `pgConnection.transaction(...)`) so
// an expected constraint-violation failure only rolls back to the savepoint,
// leaving the outer per-file transaction usable for subsequent queries —
// a bare failed query on the outer transaction instead poisons it for every
// later statement until rollback, per Postgres's abort-on-error semantics.
const expectRawFailure = async (sql: string, params: unknown[], pattern: RegExp) => {
  await expect(pgConnection.transaction((transaction: { raw: (q: string, p?: unknown[]) => Promise<unknown> }) =>
    transaction.raw(sql, params))).rejects.toThrow(pattern)
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = await rootConnection.transaction() as never
  const migrations = [
    new Migration20260716090000(undefined as never, undefined as never),
    new Migration20260716150000(undefined as never, undefined as never),
    new Migration20260716180000(undefined as never, undefined as never),
  ]
  for (const migration of [...migrations].reverse()) await run(migration, "down")
  for (const migration of migrations) await run(migration, "up")
  // Bring the audit-action CHECK to the fully-released Stage 5B.1 state
  // (widen-only, drop+recreate — safe regardless of ambient constraint
  // state or pre-existing committed rows, unlike the narrower
  // Migration20260716190000 which must not run here).
  await run(new Migration20260717100000(undefined as never, undefined as never), "up")
})

afterAll(async () => {
  await (pgConnection as unknown as { rollback: () => Promise<void> }).rollback()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (rootConnection as any)?.context?.destroy()
  await rootConnection?.destroy()
})

describe("Stage 5B.2 proposal application/Medusa-sync migration", () => {
  it("adds every new column, cleanly reversible up/up/down/down/up", async () => {
    await runSchemaMigration("up")
    for (const column of [
      "review_note", "applied_at", "applied_transaction_id", "applied_holding_id",
      "application_idempotency_key", "medusa_sync_status", "medusa_inventory_item_id",
      "medusa_stock_location_id", "medusa_sync_attempted_at", "medusa_sync_succeeded_at",
      "medusa_sync_retry_count", "medusa_sync_attempt_token", "medusa_sync_last_error",
    ]) {
      expect(await columnDefinition(column)).toBeDefined()
    }
    const syncStatusColumn = await columnDefinition("medusa_sync_status")
    expect(syncStatusColumn?.is_nullable).toBe("NO")
    expect(syncStatusColumn?.column_default).toContain("NOT_APPLICABLE")

    await runSchemaMigration("up")
    expect(await columnDefinition("review_note")).toBeDefined()

    await runSchemaMigration("down")
    expect(await columnDefinition("review_note")).toBeUndefined()
    expect(await columnDefinition("medusa_sync_status")).toBeUndefined()

    await runSchemaMigration("down")
    expect(await columnDefinition("applied_at")).toBeUndefined()

    await runSchemaMigration("up")
    expect(await columnDefinition("applied_at")).toBeDefined()
  }, 60000)

  it("strengthens the resolved-consistency check and restores the exact prior definition on down", async () => {
    await runSchemaMigration("up")
    const strengthened = await constraintDefinition("CK_trading_card_inventory_proposal_resolved_consistency")
    expect(strengthened).toContain("PENDING")

    const sourceId = `tcisrc_propappmigtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Proposal App Migration Test Source", `proposal app migration test source ${sourceId}`],
    )
    const proposalId = `tciprop_propappmigtest_${Date.now().toString(36)}`
    await expectRawFailure(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, resolved_by, resolved_at)
       values (?, ?, 'tcvar_test', 'QUANTITY_CHANGE', 'APPROVED', null, null)`,
      [proposalId, sourceId],
      /CK_trading_card_inventory_proposal_resolved_consistency|check constraint/i,
    )

    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])

    await runSchemaMigration("down")
    const restored = await constraintDefinition("CK_trading_card_inventory_proposal_resolved_consistency")
    expect(restored).not.toContain("PENDING")

    await runSchemaMigration("up")
  }, 60000)

  it("carries legacy APPLIED review rows forward as APPROVED proposals awaiting authoritative application", async () => {
    await runSchemaMigration("down")
    const sourceId = `tcisrc_legacyapplied_${Date.now().toString(36)}`
    const proposalId = `tciprop_legacyapplied_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Legacy applied source", `legacy applied ${sourceId}`],
    )
    await pgConnection.raw(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, resolved_by, resolved_at)
       values (?, ?, 'tcvar_legacy', 'QUANTITY_CHANGE', 'APPLIED', 'legacy-reviewer', now())`,
      [proposalId, sourceId],
    )

    await runSchemaMigration("up")
    const [proposal] = rows(await pgConnection.raw(
      `select review_status, applied_at, medusa_sync_status from trading_card_inventory_proposal where id = ?`, [proposalId],
    ))
    expect(proposal).toMatchObject({ review_status: "APPROVED", applied_at: null, medusa_sync_status: "NOT_APPLICABLE" })
    await pgConnection.raw(`delete from trading_card_inventory_proposal where id = ?`, [proposalId])
    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])
  }, 60000)

  it("enforces rejection_reason only on REJECTED and review_note length", async () => {
    await runSchemaMigration("up")
    const sourceId = `tcisrc_rejreasonmigtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Rejection Reason Migration Test Source", `rejection reason migration test source ${sourceId}`],
    )
    const proposalId = `tciprop_rejreasonmigtest_${Date.now().toString(36)}`
    await expectRawFailure(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, resolved_by, resolved_at, rejection_reason)
       values (?, ?, 'tcvar_test', 'QUANTITY_CHANGE', 'APPROVED', 'actor', now(), 'should not be allowed')`,
      [proposalId, sourceId],
      /CK_tci_proposal_rejection_reason_scope|check constraint/i,
    )

    await expectRawFailure(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, resolved_by, resolved_at, review_note)
       values (?, ?, 'tcvar_test', 'QUANTITY_CHANGE', 'APPROVED', 'actor', now(), ?)`,
      [proposalId, sourceId, "x".repeat(501)],
      /CK_tci_proposal_review_note_length|check constraint/i,
    )

    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])
  }, 60000)

  it("enforces applied-state and Medusa-sync-error consistency", async () => {
    await runSchemaMigration("up")
    const sourceId = `tcisrc_appliedconsmigtest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Applied Consistency Migration Test Source", `applied consistency migration test source ${sourceId}`],
    )
    const proposalId = `tciprop_appliedconsmigtest_${Date.now().toString(36)}`
    await expectRawFailure(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, resolved_by, resolved_at)
       values (?, ?, 'tcvar_test', 'QUANTITY_CHANGE', 'APPLIED', 'actor', now())`,
      [proposalId, sourceId],
      /CK_tci_proposal_applied_consistency|check constraint/i,
    )

    await expectRawFailure(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, resolved_by, resolved_at, medusa_sync_last_error)
       values (?, ?, 'tcvar_test', 'QUANTITY_CHANGE', 'APPROVED', 'actor', now(), '{"category":"NO_STOCK_LOCATION","message":"none"}'::jsonb)`,
      [proposalId, sourceId],
      /CK_tci_proposal_medusa_error_requires_failed|check constraint/i,
    )

    await expectRawFailure(
      `insert into trading_card_inventory_proposal
        (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, resolved_by, resolved_at, medusa_sync_status)
       values (?, ?, 'tcvar_test', 'QUANTITY_CHANGE', 'APPROVED', 'actor', now(), 'SYNCED')`,
      [proposalId, sourceId],
      /CK_tci_proposal_applied_consistency|check constraint/i,
    )

    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])
  }, 60000)

  it("widens the audit-action CHECK for proposal-application actions and restores the exact prior constraint on down", async () => {
    const priorDefinition = await auditActionConstraintDefinition()
    await runAuditActionMigrations("up")
    const widened = await auditActionConstraintDefinition()
    for (const action of [
      "PROPOSAL_REVIEWED", "PROPOSAL_APPLICATION_ATTEMPTED", "PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE",
      "PROPOSAL_APPLIED", "PROPOSAL_APPLICATION_RETRIED", "MEDUSA_SYNC_SUCCEEDED", "MEDUSA_SYNC_FAILED",
      "MEDUSA_SYNC_RETRIED",
    ]) {
      expect(widened).toContain(action)
    }
    expect(widened).toContain("IMPORT_PROPOSALS_REFRESHED")

    await runAuditActionMigrations("down")
    const restored = await auditActionConstraintDefinition()
    expect(restored).toBe(priorDefinition)
    expect(restored).not.toContain("PROPOSAL_REVIEWED")
    expect(restored).toContain("IMPORT_PROPOSALS_REFRESHED")

    await runAuditActionMigrations("up")
  }, 60000)
})
