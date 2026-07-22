import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"

/**
 * Stage 1: split-group workflow. NOT RUN this session — no approved,
 * isolated test database connection was available in this environment (see
 * the Stage 1 continuation report). Added per the "add the tests and report
 * them as not run" instruction rather than skipped or weakened. Run with
 * `npm run test:integration:modules` against the project's approved test
 * database before merging.
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
  return inventory.createInventorySources({
    display_name: `Split Source ${id}`, normalized_name: `split source ${id}`, provider: "PULSE", language: "EN",
  })
}

async function snapshotFixture(sourceId: string) {
  const id = suffix()
  const [snapshot] = (await pgConnection.raw(
    `insert into trading_card_inventory_snapshot (id, inventory_source_id, status, sequence_number, created_by)
     values (?, ?, 'PENDING_REVIEW', 1, 'test-actor') returning *`,
    [`tcisnap_split_${id}`, sourceId],
  )).rows
  return snapshot
}

/** Two entries sharing a variant (so they'd naturally group together), plus a PENDING proposal covering both. */
async function twoEntryGroupFixture(sourceId: string) {
  const snapshot = await snapshotFixture(sourceId)
  const variantId = `tcvar_split_${suffix()}`
  const entryIds = [`tcisentry_split_a_${suffix()}`, `tcisentry_split_b_${suffix()}`]
  for (const [index, entryId] of entryIds.entries()) {
    await pgConnection.raw(
      `insert into trading_card_inventory_snapshot_entry
        (id, inventory_snapshot_id, provider_reference, provider_reference_type, trading_card_variant_id, quantity,
         row_number, outcome, condition_candidate, finish_candidate, special_treatment_candidate)
       values (?, ?, ?, 'PULSE_PRODUCT_ID', ?, 1, ?, 'VALID', 'NEAR_MINT', 'NORMAL', 'NONE')`,
      [entryId, snapshot.id, `card:ref-${index}-${suffix()}`, variantId, index + 1],
    )
  }
  const reconciliationKey = `variant:${variantId}|sep=0|split=`
  const [proposal] = (await pgConnection.raw(
    `insert into trading_card_inventory_proposal
      (id, inventory_source_id, inventory_snapshot_id, reconciliation_key, trading_card_variant_id,
       change_kind, proposed_quantity, previous_quantity, quantity_delta, review_status)
     values (?, ?, ?, ?, ?, 'NEW_HOLDING', 2, 0, 2, 'PENDING') returning *`,
    [`tciprop_split_${suffix()}`, sourceId, snapshot.id, reconciliationKey, variantId],
  )).rows
  return { snapshot, proposal, entryIds, variantId }
}

describe("splitInventoryProposal", () => {
  it("moves a proper subset of a PENDING proposal's rows into a new sibling proposal, preserving quantity", async () => {
    const source = await sourceFixture()
    const { proposal, entryIds } = await twoEntryGroupFixture(source.id)

    const result = await inventory.splitInventoryProposal({
      proposalId: proposal.id, sourceEntryIds: [entryIds[0]], actor: "reviewer-1", source: "MANUAL",
    })

    expect(result.alreadySplit).toBe(false)
    expect(result.originalProposalId).toBe(proposal.id)
    expect(result.newProposalId).not.toBe(proposal.id)

    const original = await inventory.retrieveInventoryProposal(proposal.id)
    const created = await inventory.retrieveInventoryProposal(result.newProposalId)
    expect(original.proposed_quantity).toBe(1)
    expect(created.proposed_quantity).toBe(1)
    expect(created.review_status).toBe("PENDING")

    const [override] = (await pgConnection.raw(
      `select * from trading_card_inventory_snapshot_entry_override where snapshot_entry_id = ?`, [entryIds[0]],
    )).rows
    expect(override.split_group_key).toBeTruthy()

    const [audit] = (await pgConnection.raw(
      `select * from trading_card_inventory_audit_entry where action = 'PROPOSAL_SPLIT' and entity_id = ? order by created_at desc limit 1`,
      [proposal.id],
    )).rows
    expect(audit).toBeTruthy()
  })

  it("is idempotent: an identical repeat request returns the already-created sibling instead of duplicating it", async () => {
    const source = await sourceFixture()
    const { proposal, entryIds } = await twoEntryGroupFixture(source.id)

    const first = await inventory.splitInventoryProposal({
      proposalId: proposal.id, sourceEntryIds: [entryIds[0]], actor: "reviewer-1", source: "MANUAL",
    })
    const second = await inventory.splitInventoryProposal({
      proposalId: proposal.id, sourceEntryIds: [entryIds[0]], actor: "reviewer-1", source: "MANUAL",
    })

    expect(second.alreadySplit).toBe(true)
    expect(second.newProposalId).toBe(first.newProposalId)

    const [{ count }] = (await pgConnection.raw(
      `select count(*)::int as count from trading_card_inventory_proposal where inventory_source_id = ?`, [source.id],
    )).rows
    expect(count).toBe(2) // original + exactly one sibling, never a second duplicate
  })

  it("rejects splitting a proposal that is not PENDING", async () => {
    const source = await sourceFixture()
    const { proposal, entryIds } = await twoEntryGroupFixture(source.id)
    await pgConnection.raw(
      `update trading_card_inventory_proposal set review_status = 'APPROVED', resolved_by = 'r', resolved_at = now() where id = ?`,
      [proposal.id],
    )

    await expect(inventory.splitInventoryProposal({
      proposalId: proposal.id, sourceEntryIds: [entryIds[0]], actor: "reviewer-1", source: "MANUAL",
    })).rejects.toThrow(/PENDING|Cannot split/)
  })

  it("rejects a split selecting every row in the group (not a proper subset)", async () => {
    const source = await sourceFixture()
    const { proposal, entryIds } = await twoEntryGroupFixture(source.id)

    await expect(inventory.splitInventoryProposal({
      proposalId: proposal.id, sourceEntryIds: entryIds, actor: "reviewer-1", source: "MANUAL",
    })).rejects.toThrow(/proper|subset/)
  })

  it("rejects an empty selection", async () => {
    const source = await sourceFixture()
    const { proposal } = await twoEntryGroupFixture(source.id)

    await expect(inventory.splitInventoryProposal({
      proposalId: proposal.id, sourceEntryIds: [], actor: "reviewer-1", source: "MANUAL",
    })).rejects.toThrow()
  })
})
