import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"

/**
 * Stage 1: requires-separate-listing review override. NOT RUN this session
 * — no approved, isolated test database connection was available (see the
 * Stage 1 continuation report). Run with `npm run test:integration:modules`
 * against the project's approved test database before merging.
 */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inventory: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  inventory = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

async function sourceFixture() {
  const id = suffix()
  return inventory.createInventorySources({ display_name: `Sep Source ${id}`, normalized_name: `sep source ${id}`, provider: "PULSE", language: "EN" })
}

async function snapshotFixture(sourceId: string) {
  const id = suffix()
  const [snapshot] = (await pgConnection.raw(
    `insert into trading_card_inventory_snapshot (id, inventory_source_id, status, sequence_number, created_by)
     values (?, ?, 'PENDING_REVIEW', 1, 'test-actor') returning *`,
    [`tcisnap_sep_${id}`, sourceId],
  )).rows
  return snapshot
}

async function twoEntryGroupFixture(sourceId: string) {
  const snapshot = await snapshotFixture(sourceId)
  const variantId = `tcvar_sep_${suffix()}`
  const entryIds = [`tcisentry_sep_a_${suffix()}`, `tcisentry_sep_b_${suffix()}`]
  for (const [index, entryId] of entryIds.entries()) {
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry
        (id, inventory_snapshot_id, provider_reference, provider_reference_type, trading_card_variant_id, quantity,
         row_number, outcome, condition_candidate, finish_candidate, special_treatment_candidate, requires_separate_listing)
       values (?, ?, ?, 'PULSE_PRODUCT_ID', ?, 1, ?, 'VALID', 'NEAR_MINT', 'NORMAL', 'NONE', false)`,
      [entryId, snapshot.id, `card:sep-ref-${index}-${suffix()}`, variantId, index + 1],
    )
  }
  const reconciliationKey = `variant:${variantId}|sep=0|split=`
  const [proposal] = (await pgConnection.raw(
    `insert into trading_card_inventory_proposal
      (id, inventory_source_id, inventory_snapshot_id, reconciliation_key, trading_card_variant_id,
       change_kind, proposed_quantity, previous_quantity, quantity_delta, review_status, requires_separate_listing)
     values (?, ?, ?, ?, ?, 'NEW_HOLDING', 2, 0, 2, 'PENDING', false) returning *`,
    [`tciprop_sep_${suffix()}`, sourceId, snapshot.id, reconciliationKey, variantId],
  )).rows
  return { snapshot, proposal, entryIds, variantId }
}

describe("setRequiresSeparateListingOverride", () => {
  it("flips the whole group in place when no subset is given", async () => {
    const source = await sourceFixture()
    const { proposal, entryIds } = await twoEntryGroupFixture(source.id)

    const result = await inventory.setRequiresSeparateListingOverride({
      proposalId: proposal.id, requiresSeparateListing: true, actor: "reviewer-1", source: "MANUAL",
    })

    expect(result.newProposalId).toBeNull()
    expect(result.affectedEntryIds.sort()).toEqual([...entryIds].sort())
    const updated = await inventory.retrieveInventoryProposal(proposal.id)
    expect(updated.reconciliation_key).toContain("sep=1")
    expect(updated.proposed_quantity).toBe(2)
  })

  it("splits a partial subset into a new proposal, never leaving true and false rows merged", async () => {
    const source = await sourceFixture()
    const { proposal, entryIds } = await twoEntryGroupFixture(source.id)

    const result = await inventory.setRequiresSeparateListingOverride({
      proposalId: proposal.id, sourceEntryIds: [entryIds[0]], requiresSeparateListing: true, actor: "reviewer-1", source: "MANUAL",
    })

    expect(result.newProposalId).not.toBeNull()
    const original = await inventory.retrieveInventoryProposal(proposal.id)
    const created = await inventory.retrieveInventoryProposal(result.newProposalId)
    expect(original.reconciliation_key).toContain("sep=0")
    expect(created.reconciliation_key).toContain("sep=1")
    expect(original.proposed_quantity).toBe(1)
    expect(created.proposed_quantity).toBe(1)

    // The two groups must never re-merge on a later reconciliation pass — confirmed structurally by
    // asserting they now have distinct reconciliation_key values, which reconcile.ts's groupKey always
    // reproduces deterministically from each entry's (possibly overridden) requiresSeparateListing.
    expect(original.reconciliation_key).not.toBe(created.reconciliation_key)
  })

  it("is idempotent: setting the same value again is a no-op", async () => {
    const source = await sourceFixture()
    const { proposal } = await twoEntryGroupFixture(source.id)

    const result = await inventory.setRequiresSeparateListingOverride({
      proposalId: proposal.id, requiresSeparateListing: false, actor: "reviewer-1", source: "MANUAL",
    })
    expect(result.newProposalId).toBeNull()
    expect(result.affectedEntryIds).toEqual([])
  })

  it("rejects changing a non-PENDING proposal", async () => {
    const source = await sourceFixture()
    const { proposal } = await twoEntryGroupFixture(source.id)
    await pgConnection.raw(
      `update trading_card_inventory_proposal set review_status = 'APPLIED', resolved_by = 'r', resolved_at = now(),
       applied_at = now(), applied_transaction_id = 'x', applied_holding_id = 'y', application_idempotency_key = ?, medusa_sync_status = 'PENDING'
       where id = ?`,
      [`idem_${suffix()}`, proposal.id],
    )
    await expect(inventory.setRequiresSeparateListingOverride({
      proposalId: proposal.id, requiresSeparateListing: true, actor: "reviewer-1", source: "MANUAL",
    })).rejects.toThrow(/PENDING/)
  })

  it("records a PROPOSAL_SEPARATE_LISTING_OVERRIDDEN audit entry", async () => {
    const source = await sourceFixture()
    const { proposal } = await twoEntryGroupFixture(source.id)
    await inventory.setRequiresSeparateListingOverride({
      proposalId: proposal.id, requiresSeparateListing: true, actor: "reviewer-1", source: "MANUAL",
    })
    const [audit] = (await pgConnection.raw(
      `select * from trading_card_inventory_audit_entry where action = 'PROPOSAL_SEPARATE_LISTING_OVERRIDDEN' and entity_id = ? order by created_at desc limit 1`,
      [proposal.id],
    )).rows
    expect(audit).toBeTruthy()
  })
})
