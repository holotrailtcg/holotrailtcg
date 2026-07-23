import { randomUUID } from "node:crypto"
import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { EBAY_INTEGRATION_MODULE } from "../../ebay-integration"

/**
 * PR review fix: the reviewer-confirmed eBay Store category must be
 * re-validated ACTIVE (and Medusa-synced) at the exact moment a NEW_HOLDING
 * proposal is locally applied — never trusted from confirmation time alone,
 * since the category can be removed or desynced in between. This exercises
 * `TradingCardInventoryModuleService#applyInventoryProposal`'s own gate
 * directly, inside the same transaction that moves stock.
 */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inventory: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ebayIntegration: any
let connectedScopeFixture: { environment: "SANDBOX"; ebayAccountId: string } | undefined

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  medusaApp = await MedusaApp({
    modulesConfig: {
      [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" },
      [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards", definition: { key: TRADING_CARDS_MODULE, isQueryable: true } },
      [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" },
    },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
  inventory = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
  ebayIntegration = medusaApp.modules[EBAY_INTEGRATION_MODULE]
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

async function cardVariantFixture() {
  const id = suffix()
  const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${id}`, provider_set_code: `set_${id}` })
  const card = await cards.createTradingCards({
    card_set_id: set.id, name: `Gate Card ${id}`, search_name: `gate card ${id}`,
    card_number: "001", card_number_normalised: "001", origin: "MANUAL",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT", finish: "NORMAL", finish_confirmed: true,
    special_treatment: "NONE", special_treatment_confirmed: true, sku: `SKU-GATE-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
  })
  return { variant }
}

async function sourceFixture() {
  const id = suffix()
  return inventory.createInventorySources({
    display_name: `Gate Source ${id}`,
    normalized_name: `gate source ${id}`,
    provider: "PULSE",
  })
}

async function connectedEbayScope() {
  if (connectedScopeFixture) return connectedScopeFixture

  const id = suffix()
  const attemptId = randomUUID()
  const [existing] = (await pgConnection.raw(
    `select id, ebay_account_id from ebay_integration_connection
     where environment = 'SANDBOX' and deleted_at is null limit 1`,
  )).rows as Array<{ id: string; ebay_account_id: string | null }>
  if (existing) {
    const ebayAccountId = existing.ebay_account_id ?? `acct_${id}`
    await pgConnection.raw(
      `update ebay_integration_connection set status = 'CONNECTED', ebay_account_id = ?, current_attempt_id = ?,
       credential_generation = ?, refresh_token_ciphertext = 'fixture-ciphertext', refresh_token_iv = 'fixture-iv',
       refresh_token_auth_tag = 'fixture-auth-tag', encryption_key_version = 'fixture-key-v1',
       refresh_operation_id = null, refresh_operation_started_at = null where id = ?`,
      [ebayAccountId, attemptId, attemptId, existing.id],
    )
    connectedScopeFixture = { environment: "SANDBOX", ebayAccountId }
    return connectedScopeFixture
  }

  await pgConnection.raw(
    `insert into ebay_integration_connection
      (id, environment, status, ebay_account_id, current_attempt_id, credential_generation,
       refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag, encryption_key_version, granted_scopes)
     values (?, 'SANDBOX', 'CONNECTED', ?, ?, ?, 'fixture-ciphertext', 'fixture-iv', 'fixture-auth-tag', 'fixture-key-v1', '[]'::jsonb)`,
    [`ebconn_${id}`, `acct_${id}`, attemptId, attemptId],
  )
  connectedScopeFixture = { environment: "SANDBOX", ebayAccountId: `acct_${id}` }
  return connectedScopeFixture
}

async function approvedProposalFixture(input: {
  sourceId: string
  variantId: string
  confirmedCategoryId?: string | null
}) {
  const proposalId = `tciprop_gate_${suffix()}`
  await pgConnection.raw(
    `insert into trading_card_inventory_proposal
      (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, proposed_quantity, previous_quantity,
       resolved_by, resolved_at, confirmed_ebay_store_category_id, category_confirmed_at, category_confirmed_by)
     values (?, ?, ?, 'NEW_HOLDING', 'APPROVED', 3, 0, 'reviewer', now(), ?, ?, ?)`,
    [
      proposalId, input.sourceId, input.variantId,
      input.confirmedCategoryId ?? null,
      input.confirmedCategoryId ? new Date() : null,
      input.confirmedCategoryId ? "reviewer" : null,
    ],
  )
  return proposalId
}

describe("applyInventoryProposal — E2B category re-validation gate", () => {
  it("rejects a NEW_HOLDING proposal and clears the stale confirmation when the confirmed category has since been removed", async () => {
    const scope = await connectedEbayScope()
    const category = await ebayIntegration.createStoreCategory({
      environment: scope.environment, externalId: `ext_${suffix()}`, name: "Reverse Holos",
      parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
    })
    await ebayIntegration.linkStoreCategoryToMedusaCategory(category.id, `pcat_${suffix()}`)
    await ebayIntegration.removeStoreCategory({
      environment: scope.environment, id: category.id, reason: "test removal", actorId: "test-actor", correlationId: suffix(),
    })

    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: category.id })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("INVALID_STATE")
    expect(result.errorCode).toBe("CATEGORY_NO_LONGER_ACTIVE")

    const [saved] = (await pgConnection.raw(
      `select confirmed_ebay_store_category_id, category_confirmed_at, category_confirmed_by, review_status
       from trading_card_inventory_proposal where id = ?`, [proposalId],
    )).rows
    expect(saved.confirmed_ebay_store_category_id).toBeNull()
    expect(saved.category_confirmed_at).toBeNull()
    expect(saved.category_confirmed_by).toBeNull()
    expect(saved.review_status).toBe("APPROVED")
  }, 60000)

  it("rejects a NEW_HOLDING proposal whose confirmed category is active but not yet synced to Medusa", async () => {
    const scope = await connectedEbayScope()
    const category = await ebayIntegration.createStoreCategory({
      environment: scope.environment, externalId: `ext_${suffix()}`, name: "Illustration Rares",
      parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
    })
    // Deliberately never synced — medusa_category_id stays null.

    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: category.id })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("INVALID_STATE")
    expect(result.errorCode).toBe("CATEGORY_NOT_SYNCED")
  }, 60000)

  it("rejects a NEW_HOLDING proposal with no confirmed category at all", async () => {
    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: null })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("INVALID_STATE")
    expect(result.errorCode).toBe("CATEGORY_NOT_CONFIRMED")
  }, 60000)

  it("applies a NEW_HOLDING proposal whose confirmed category is active and synced", async () => {
    const scope = await connectedEbayScope()
    const category = await ebayIntegration.createStoreCategory({
      environment: scope.environment, externalId: `ext_${suffix()}`, name: "Graded Cards",
      parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
    })
    await ebayIntegration.linkStoreCategoryToMedusaCategory(category.id, `pcat_${suffix()}`)

    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: category.id })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("APPLIED")
  }, 60000)
})

describe("confirmProposalCategory — requireUnconfirmed compare-and-set", () => {
  it("never overwrites a reviewer's manual confirmation with a stale automatic rule match (requireUnconfirmed: true)", async () => {
    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id })

    // A reviewer manually confirms category A first.
    await inventory.confirmProposalCategory({
      proposalId, storeCategoryId: `ebcat_manual_${suffix()}`, actor: "reviewer-1", source: "MANUAL",
    })
    const afterManual = (await pgConnection.raw(
      `select confirmed_ebay_store_category_id from trading_card_inventory_proposal where id = ?`, [proposalId],
    )).rows[0]

    // The automatic rule-match path (`requireUnconfirmed: true`) then tries
    // to confirm a *different* category — as if it had evaluated the ruleset
    // before the reviewer's manual confirmation landed. It must not win.
    const afterAuto = await inventory.confirmProposalCategory({
      proposalId, storeCategoryId: `ebcat_auto_${suffix()}`, actor: "system:category-rule-auto-confirm",
      source: "SYSTEM", requireUnconfirmed: true,
    })

    expect(afterAuto.confirmed_ebay_store_category_id).toBe(afterManual.confirmed_ebay_store_category_id)

    const [finalRow] = (await pgConnection.raw(
      `select confirmed_ebay_store_category_id from trading_card_inventory_proposal where id = ?`, [proposalId],
    )).rows
    expect(finalRow.confirmed_ebay_store_category_id).toBe(afterManual.confirmed_ebay_store_category_id)
  })

  it("still confirms normally with requireUnconfirmed: true when nothing has confirmed the proposal yet", async () => {
    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id })

    const storeCategoryId = `ebcat_auto_${suffix()}`
    const result = await inventory.confirmProposalCategory({
      proposalId, storeCategoryId, actor: "system:category-rule-auto-confirm", source: "SYSTEM", requireUnconfirmed: true,
    })

    expect(result.confirmed_ebay_store_category_id).toBe(storeCategoryId)
  })
})
