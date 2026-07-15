import { generateEntityId, MedusaError, MedusaService } from "@medusajs/framework/utils"
import CardSet from "./models/card-set"
import TradingCard from "./models/trading-card"
import TradingCardVariant from "./models/trading-card-variant"
import ExternalCardReference from "./models/external-card-reference"
import CardAuditEntry from "./models/card-audit-entry"
import RarityMapping from "./models/rarity-mapping"
import TcgDexEnrichmentProposal from "./models/tcgdex-enrichment-proposal"
import TcgDexEnrichmentAttempt from "./models/tcgdex-enrichment-attempt"
import { cardNumberForms } from "./identity/card-number"
import { rarityComparisonForm } from "./rarity/normalise-rarity"
import {
  AUDIT_ACTION, AUDIT_ENTITY_TYPE, type CardCondition, type CardFinish,
  type CardLanguage, type ConditionSource, type ExternalProvider, type RecordOrigin, type SpecialTreatment,
  EXTERNAL_REFERENCE_PROVENANCE, type ExternalReferenceProvenance,
} from "./types"
import type { TcgDexMatchResult } from "./tcgdex/matching-types"
import { auditContextSchema, canonicalSnapshot, diagnosticFingerprint, enrichmentSnapshotSchema, providerIdentifierSchema, snapshotFingerprint, tcgdexMatchResultSchema, tradingCardIdSchema } from "./tcgdex/persistence-validation"

interface TxManager {
  execute<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>
}
interface EntityManager extends TxManager {
  transactional<T>(callback: (manager: TxManager) => Promise<T>): Promise<T>
}

export interface AuditContext { actor: string; source: RecordOrigin; reason?: string | null }

export interface UpdateTradingCardIdentityInput extends AuditContext {
  id: string
  cardSetId?: string
  name?: string
  searchName?: string
  slug?: string | null
  cardNumber?: string
}

export interface UpdateVariantConditionInput extends AuditContext {
  id: string; condition: CardCondition; conditionSource: ConditionSource
}
export interface UpdateVariantFinishInput extends AuditContext {
  id: string; finish: CardFinish; confirmed: boolean
}
export interface UpdateVariantTreatmentInput extends AuditContext {
  id: string; specialTreatment: SpecialTreatment; confirmed: boolean
}

export interface UpsertExternalReferenceInput extends AuditContext {
  /** Required for an intentional update; omitted calls are create-or-return-idempotently. */
  referenceId?: string
  /** PostgreSQL row version returned by the preceding read; prevents racing updates. */
  expectedVersion?: string
  tradingCardId: string
  cardSetId?: string
  tradingCardVariantId?: string | null
  provider: ExternalProvider
  providerIdentifier: string
  language?: CardLanguage | null
  region?: string | null
  rawPayloadNote?: string | null
  provenance?: ExternalReferenceProvenance
}

export const EXTERNAL_REFERENCE_NOTE_MAX_LENGTH = 500

interface PriceLockState {
  price_locked: boolean
  price_locked_at: Date | string | null
  price_locked_actor: string | null
  price_lock_reason: string | null
}

const auditPriceLockState = (state: PriceLockState) => ({
  price_locked: state.price_locked,
  price_locked_at: state.price_locked_at,
  price_locked_by: state.price_locked_actor,
  price_lock_reason: state.price_lock_reason,
})

const externalReferenceAuditState = (value: Record<string, unknown>) => ({
  provider: value.provider,
  provider_identifier: value.provider_identifier,
  trading_card_id: value.trading_card_id,
  card_set_id: value.card_set_id ?? null,
  trading_card_variant_id: value.trading_card_variant_id ?? null,
  language: value.language ?? null,
  region: value.region ?? null,
  provenance: value.provenance ?? EXTERNAL_REFERENCE_PROVENANCE.AUTOMATIC,
})

class TradingCardsModuleService extends MedusaService({
  CardSet, TradingCard, TradingCardVariant, ExternalCardReference, CardAuditEntry, RarityMapping,
  TcgDexEnrichmentProposal, TcgDexEnrichmentAttempt,
}) {
  protected manager_: EntityManager

  constructor(container: { manager: EntityManager }) {
    // @ts-ignore MedusaService's generated constructor accepts the module container.
    super(...arguments)
    this.manager_ = container.manager
  }

  private lifecycleMutationBlocked = (name: string): never => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${name} is owned by the TCGdex enrichment domain service`)
  }

  createTcgDexEnrichmentProposals = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment proposal creation")
  updateTcgDexEnrichmentProposals = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment proposal updates")
  deleteTcgDexEnrichmentProposals = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment proposal deletion")
  softDeleteTcgDexEnrichmentProposals = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment proposal deletion")
  restoreTcgDexEnrichmentProposals = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment proposal restoration")
  createTcgDexEnrichmentAttempts = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment diagnostic creation")
  updateTcgDexEnrichmentAttempts = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment diagnostic updates")
  deleteTcgDexEnrichmentAttempts = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment diagnostic deletion")
  softDeleteTcgDexEnrichmentAttempts = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment diagnostic deletion")
  restoreTcgDexEnrichmentAttempts = async (): Promise<never> => this.lifecycleMutationBlocked("Enrichment diagnostic restoration")

  updateCardAuditEntries = async (): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Card audit entries are append-only")
  }

  deleteCardAuditEntries = async (): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Card audit entries cannot be deleted")
  }

  softDeleteCardAuditEntries = async (): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Card audit entries cannot be deleted")
  }

  restoreCardAuditEntries = async (): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Card audit entries cannot be restored")
  }

  private async writeAudit(manager: TxManager, input: AuditContext & {
    entityType: string; entityId: string; action: string; oldValue?: unknown; newValue?: unknown
  }) {
    await manager.execute(
      `insert into trading_card_audit_entry
       (id, actor, entity_type, entity_id, action, old_value, new_value, reason, source)
       values (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [
        generateEntityId(undefined, "tcaud"), input.actor, input.entityType, input.entityId, input.action,
        input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
        input.newValue === undefined ? null : JSON.stringify(input.newValue),
        input.reason ?? null, input.source,
      ]
    )
  }

  async updateTradingCardIdentity(input: UpdateTradingCardIdentityInput) {
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<Record<string, unknown>>(
        `select id, card_set_id, name, search_name, slug, card_number, card_number_normalised
         from trading_card where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card not found")
      const numbers = input.cardNumber === undefined ? null : cardNumberForms(input.cardNumber)
      const next = {
        card_set_id: input.cardSetId ?? current.card_set_id,
        name: input.name ?? current.name,
        search_name: input.searchName ?? current.search_name,
        slug: input.slug === undefined ? current.slug : input.slug,
        card_number: numbers?.original ?? current.card_number,
        card_number_normalised: numbers?.normalised ?? current.card_number_normalised,
      }
      await manager.execute(
        `update trading_card set card_set_id = ?, name = ?, search_name = ?, slug = ?,
         card_number = ?, card_number_normalised = ?, updated_at = now() where id = ?`,
        [next.card_set_id, next.name, next.search_name, next.slug, next.card_number, next.card_number_normalised, input.id]
      )
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.TRADING_CARD, entityId: input.id,
        action: AUDIT_ACTION.CANONICAL_IDENTITY_CHANGED, oldValue: current, newValue: next,
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card where id = ? and deleted_at is null`, [input.id]
      )
      return saved
    })
  }

  async recordTrustedTcgdexCardReference(input: AuditContext & { tradingCardId: string; providerIdentifier: string; language?: CardLanguage | null }) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason }); tradingCardIdSchema.parse(input.tradingCardId); providerIdentifierSchema.parse(input.providerIdentifier)
    return this.manager_.transactional(async (manager) => {
      const reference = await this.upsertExternalReferenceInTransaction(manager, { ...input, tradingCardId: input.tradingCardId, provider: "TCGDEX", providerIdentifier: input.providerIdentifier, provenance: EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL }) as Record<string, unknown>
      await this.recordManualReferenceAudit(manager, input, reference.id as string)
      return reference
    })
  }

  private async recordManualReferenceAudit(manager: TxManager, input: AuditContext, referenceId: string) {
    const [existing] = await manager.execute(`select id from trading_card_audit_entry where entity_id = ? and action = 'TCGDEX_MANUAL_REFERENCE_RECORDED' and deleted_at is null limit 1`, [referenceId])
    if (!existing) await this.writeAudit(manager, { ...input, entityType: "EXTERNAL_CARD_REFERENCE", entityId: referenceId, action: "TCGDEX_MANUAL_REFERENCE_RECORDED", newValue: { referenceId, provider: "TCGDEX" } })
  }

  async recordTrustedTcgdexSetReference(input: AuditContext & { cardSetId: string; providerIdentifier: string; language?: CardLanguage | null }) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason }); tradingCardIdSchema.parse(input.cardSetId); providerIdentifierSchema.parse(input.providerIdentifier)
    return this.manager_.transactional(async (manager) => {
      const reference = await this.upsertExternalReferenceInTransaction(manager, { ...input, tradingCardId: "", cardSetId: input.cardSetId, provider: "TCGDEX", providerIdentifier: `SET:${input.providerIdentifier}`, provenance: EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL }) as Record<string, unknown>
      await this.recordManualReferenceAudit(manager, input, reference.id as string)
      return reference
    })
  }

  async recordTcgdexMatchResult(input: AuditContext & { tradingCardId: string; result: TcgDexMatchResult }) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason }); tradingCardIdSchema.parse(input.tradingCardId)
    return this.manager_.transactional(async (manager) => {
      const result = tcgdexMatchResultSchema.parse(input.result) as TcgDexMatchResult
      if (result.code !== "MATCHED") {
        const diagnostic = result.code === "PROVIDER_ERROR" ? { code: result.code, providerCode: result.providerCode } : result
        const fingerprint = diagnosticFingerprint(diagnostic)
        const [existing] = await manager.execute<Record<string, unknown>>(`select * from trading_card_tcgdex_enrichment_attempt where trading_card_id = ? and provider = ? and diagnostic_fingerprint = ? and deleted_at is null`, [input.tradingCardId, "TCGDEX", fingerprint])
        if (existing) return existing
        const id = generateEntityId(undefined, "tcea")
        try {
          await manager.execute(`insert into trading_card_tcgdex_enrichment_attempt (id, trading_card_id, provider, match_source, match_outcome, provider_card_id, provider_set_id, safe_provider_error_code, diagnostic_fingerprint) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, input.tradingCardId, "TCGDEX", result.source, result.code, result.code === "IDENTITY_MISMATCH" ? result.actual.localId : null, result.code === "IDENTITY_MISMATCH" ? result.actual.setId : null, result.code === "PROVIDER_ERROR" ? result.providerCode : null, fingerprint])
        } catch (error) {
          const databaseError = error as { code?: string; constraint?: string }
          if (databaseError.code !== "23505" || databaseError.constraint !== "IDX_tcgdex_attempt_diagnostic") throw error
          const [concurrent] = await manager.execute<Record<string, unknown>>(`select * from trading_card_tcgdex_enrichment_attempt where trading_card_id = ? and provider = ? and diagnostic_fingerprint = ? and deleted_at is null`, [input.tradingCardId, "TCGDEX", fingerprint])
          if (concurrent) return concurrent
          throw error
        }
        return (await manager.execute(`select * from trading_card_tcgdex_enrichment_attempt where id = ?`, [id]))[0]
      }
      const snapshot = canonicalSnapshot(result.enrichment)
      const fingerprint = snapshotFingerprint(snapshot)
      await manager.execute(`select id from trading_card where id = ? and deleted_at is null for update`, [input.tradingCardId])
      const [same] = await manager.execute<Record<string, unknown>>(`select * from trading_card_tcgdex_enrichment_proposal where trading_card_id = ? and provider = ? and snapshot_fingerprint = ? and deleted_at is null`, [input.tradingCardId, "TCGDEX", fingerprint])
      if (same) return same
      const [current] = await manager.execute<Record<string, unknown>>(`select * from trading_card_tcgdex_enrichment_proposal where trading_card_id = ? and provider = ? and review_status in ('PENDING','APPROVED') and deleted_at is null order by created_at desc limit 1 for update`, [input.tradingCardId, "TCGDEX"])
      if (current?.review_status === "APPROVED") throw new MedusaError(MedusaError.Types.INVALID_DATA, "An approved TCGdex enrichment proposal requires explicit resolution")
      if (current?.review_status === "PENDING") {
        await manager.execute(`update trading_card_tcgdex_enrichment_proposal set review_status = 'SUPERSEDED', updated_at = now() where id = ?`, [current.id])
        await this.writeAudit(manager, { ...input, entityType: "ENRICHMENT_PROPOSAL", entityId: current.id as string, action: "TCGDEX_ENRICHMENT_SUPERSEDED", oldValue: { proposalId: current.id, reviewStatus: "PENDING" }, newValue: { proposalId: current.id, reviewStatus: "SUPERSEDED" } })
      }
      const id = generateEntityId(undefined, "tcep")
      await manager.execute(`insert into trading_card_tcgdex_enrichment_proposal (id, trading_card_id, provider, provider_card_id, provider_set_id, match_source, snapshot, snapshot_fingerprint, review_status) values (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'PENDING')`, [id, input.tradingCardId, "TCGDEX", snapshot.providerCardId, snapshot.providerSetId, result.source, JSON.stringify(snapshot), fingerprint])
      await this.writeAudit(manager, { ...input, entityType: "ENRICHMENT_PROPOSAL", entityId: id, action: "TCGDEX_ENRICHMENT_RECORDED", newValue: { proposalId: id, provider: "TCGDEX", providerCardId: snapshot.providerCardId, providerSetId: snapshot.providerSetId, matchSource: result.source, matchOutcome: "MATCHED", reviewStatus: "PENDING" } })
      return (await manager.execute<Record<string, unknown>>(`select * from trading_card_tcgdex_enrichment_proposal where id = ?`, [id]))[0]
    })
  }

  private async transitionEnrichment(input: AuditContext & { proposalId: string; target: "APPROVED" | "REJECTED" }) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason }); tradingCardIdSchema.parse(input.proposalId)
    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(`select * from trading_card_tcgdex_enrichment_proposal where id = ? and deleted_at is null for update`, [input.proposalId])
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Enrichment proposal not found")
      if (proposal.review_status === input.target) return proposal
      if (proposal.review_status !== "PENDING") throw new MedusaError(MedusaError.Types.INVALID_DATA, `Cannot move ${proposal.review_status} proposal to ${input.target}`)
      await manager.execute(`update trading_card_tcgdex_enrichment_proposal set review_status = ?, reviewed_at = now(), reviewer_id = ?, updated_at = now() where id = ?`, [input.target, input.actor || null, input.proposalId])
      await this.writeAudit(manager, { ...input, entityType: "ENRICHMENT_PROPOSAL", entityId: input.proposalId, action: input.target === "APPROVED" ? "TCGDEX_ENRICHMENT_APPROVED" : "TCGDEX_ENRICHMENT_REJECTED", newValue: { proposalId: input.proposalId, reviewStatus: input.target } })
      return (await manager.execute(`select * from trading_card_tcgdex_enrichment_proposal where id = ?`, [input.proposalId]))[0]
    })
  }

  async approveEnrichmentProposal(input: AuditContext & { proposalId: string }) { return this.transitionEnrichment({ ...input, target: "APPROVED" }) }
  async rejectEnrichmentProposal(input: AuditContext & { proposalId: string }) { return this.transitionEnrichment({ ...input, target: "REJECTED" }) }

  async applyApprovedEnrichmentProposal(input: AuditContext & { proposalId: string }) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason }); tradingCardIdSchema.parse(input.proposalId)
    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(`select * from trading_card_tcgdex_enrichment_proposal where id = ? and deleted_at is null for update`, [input.proposalId])
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Enrichment proposal not found")
      if (proposal.review_status === "APPLIED") return proposal
      if (proposal.review_status !== "APPROVED") throw new MedusaError(MedusaError.Types.INVALID_DATA, "Only approved enrichment proposals can be applied")
      const snapshot = enrichmentSnapshotSchema.parse(proposal.snapshot)
      const [card] = await manager.execute<Record<string, unknown>>(`select * from trading_card where id = ? and deleted_at is null for update`, [proposal.trading_card_id])
      if (!card) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card not found")
      const changedFields: string[] = []
      const values: unknown[] = []
      const assignments: string[] = []
      if (card.name !== snapshot.name) { assignments.push("name = ?", "search_name = ?"); values.push(snapshot.name, snapshot.name.toLocaleLowerCase()); changedFields.push("name") }
      if (snapshot.rarityCandidate?.status === "MAPPED" && (card.rarity !== snapshot.rarityCandidate.rarity || card.rarity_icon_key !== snapshot.rarityCandidate.iconKey)) { assignments.push("rarity = ?", "rarity_icon_key = ?", "rarity_raw = ?", "rarity_comparison = ?"); values.push(snapshot.rarityCandidate.rarity, snapshot.rarityCandidate.iconKey, snapshot.rarityCandidate.providerValue, rarityComparisonForm(snapshot.rarityCandidate.providerValue)); changedFields.push("rarity") }
      if (assignments.length) await manager.execute(`update trading_card set ${assignments.join(", ")}, origin = 'TCGDEX', updated_at = now() where id = ?`, [...values, card.id])
      await this.upsertExternalReferenceInTransaction(manager, { actor: input.actor, source: input.source, tradingCardId: card.id as string, provider: "TCGDEX", providerIdentifier: snapshot.providerCardId, provenance: EXTERNAL_REFERENCE_PROVENANCE.AUTOMATIC })
      await this.upsertExternalReferenceInTransaction(manager, { actor: input.actor, source: input.source, tradingCardId: "", cardSetId: card.card_set_id as string, provider: "TCGDEX", providerIdentifier: `SET:${snapshot.providerSetId}`, provenance: EXTERNAL_REFERENCE_PROVENANCE.AUTOMATIC })
      await manager.execute(`update trading_card_tcgdex_enrichment_proposal set review_status = 'APPLIED', applied_at = now(), updated_at = now() where id = ?`, [input.proposalId])
      await this.writeAudit(manager, { ...input, entityType: "ENRICHMENT_PROPOSAL", entityId: input.proposalId, action: "TCGDEX_ENRICHMENT_APPLIED", newValue: { proposalId: input.proposalId, reviewStatus: "APPLIED", changedFields } })
      return (await manager.execute(`select * from trading_card_tcgdex_enrichment_proposal where id = ?`, [input.proposalId]))[0]
    })
  }

  private async updateVariantFields(input: AuditContext & { id: string }, change: Record<string, unknown>, action: string) {
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_variant where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card variant not found")
      const allowed = new Set(["condition", "condition_source", "finish", "finish_confirmed", "special_treatment", "special_treatment_confirmed"])
      const entries = Object.entries(change)
      if (!entries.every(([key]) => allowed.has(key))) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported variant change")
      }
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ")
      await manager.execute(`update trading_card_variant set ${assignments}, updated_at = now() where id = ?`, [
        ...entries.map(([, value]) => value), input.id,
      ])
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.TRADING_CARD_VARIANT, entityId: input.id, action,
        oldValue: Object.fromEntries(entries.map(([key]) => [key, current[key]])), newValue: change,
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_variant where id = ? and deleted_at is null`, [input.id]
      )
      return saved
    })
  }

  async updateVariantCondition(input: UpdateVariantConditionInput) {
    return this.updateVariantFields(input, { condition: input.condition, condition_source: input.conditionSource }, AUDIT_ACTION.CONDITION_CHANGED)
  }
  async updateVariantFinish(input: UpdateVariantFinishInput) {
    return this.updateVariantFields(input, { finish: input.finish, finish_confirmed: input.confirmed }, AUDIT_ACTION.FINISH_CHANGED)
  }
  async updateVariantSpecialTreatment(input: UpdateVariantTreatmentInput) {
    return this.updateVariantFields(input, {
      special_treatment: input.specialTreatment, special_treatment_confirmed: input.confirmed,
    }, AUDIT_ACTION.SPECIAL_TREATMENT_CHANGED)
  }

  async lockVariantPrice(input: AuditContext & { id: string }) {
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<PriceLockState>(
        `select price_locked, price_locked_at, price_locked_actor, price_lock_reason
         from trading_card_variant where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card variant not found")
      if (!current.price_locked) {
        const [locked] = await manager.execute<PriceLockState>(
          `update trading_card_variant set price_locked = true, price_locked_at = now(), price_locked_actor = ?,
           price_lock_reason = ?, updated_at = now() where id = ?
           returning price_locked, price_locked_at, price_locked_actor, price_lock_reason`,
          [input.actor, input.reason ?? null, input.id]
        )
        await this.writeAudit(manager, {
          ...input, entityType: AUDIT_ENTITY_TYPE.TRADING_CARD_VARIANT, entityId: input.id,
          action: AUDIT_ACTION.PRICE_LOCKED,
          oldValue: auditPriceLockState(current), newValue: auditPriceLockState(locked),
        })
      }
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_variant where id = ? and deleted_at is null`, [input.id]
      )
      return saved
    })
  }

  async unlockVariantPrice(input: AuditContext & { id: string }) {
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<PriceLockState>(
        `select price_locked, price_locked_at, price_locked_actor, price_lock_reason
         from trading_card_variant where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card variant not found")
      if (current.price_locked) {
        const [unlocked] = await manager.execute<PriceLockState>(
          `update trading_card_variant set price_locked = false, price_locked_at = null, price_locked_actor = null,
           price_lock_reason = null, updated_at = now() where id = ?
           returning price_locked, price_locked_at, price_locked_actor, price_lock_reason`, [input.id]
        )
        await this.writeAudit(manager, {
          ...input, entityType: AUDIT_ENTITY_TYPE.TRADING_CARD_VARIANT, entityId: input.id,
          action: AUDIT_ACTION.PRICE_UNLOCKED,
          oldValue: auditPriceLockState(current), newValue: auditPriceLockState(unlocked),
        })
      }
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_variant where id = ? and deleted_at is null`, [input.id]
      )
      return saved
    })
  }

  async assertPriceNotLocked(id: string): Promise<void> {
    const variant = await this.retrieveTradingCardVariant(id)
    if (variant.price_locked) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Trading card variant price is locked")
    }
  }

  async normaliseRarity(input: { provider: ExternalProvider; language?: CardLanguage | null; rawValue: string }) {
    const comparison = rarityComparisonForm(input.rawValue)
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_rarity_mapping
       where provider = ? and comparison_value = ? and deleted_at is null
         and (language = ? or language is null)
       order by case when language = ? then 0 else 1 end limit 1`,
      [input.provider, comparison, input.language ?? null, input.language ?? null]
    )
    return rows[0] ?? null
  }

  async assertVariantProductHierarchy(input: { productVariantProductId?: string | null; tradingCardProductId?: string | null }): Promise<void> {
    if (!input.productVariantProductId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product variant is not assigned to a Medusa product")
    }
    if (!input.tradingCardProductId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Trading card is not linked to a Medusa product")
    }
    if (input.productVariantProductId !== input.tradingCardProductId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Product variant and trading card must belong to the same Medusa product"
      )
    }
  }

  async upsertExternalReference(input: UpsertExternalReferenceInput) {
    return this.manager_.transactional((manager) => this.upsertExternalReferenceInTransaction(manager, input))
  }

  private async upsertExternalReferenceInTransaction(manager: TxManager, input: UpsertExternalReferenceInput) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason }); providerIdentifierSchema.parse(input.providerIdentifier)
    if (input.tradingCardId) tradingCardIdSchema.parse(input.tradingCardId)
    if (input.cardSetId) tradingCardIdSchema.parse(input.cardSetId)
    if (input.tradingCardVariantId) tradingCardIdSchema.parse(input.tradingCardVariantId)
    if (input.rawPayloadNote !== undefined && input.rawPayloadNote !== null) {
      if (typeof input.rawPayloadNote !== "string") {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "External reference note must be a string")
      }
      if (input.rawPayloadNote.length > EXTERNAL_REFERENCE_NOTE_MAX_LENGTH) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `External reference note must be at most ${EXTERNAL_REFERENCE_NOTE_MAX_LENGTH} characters`
        )
      }
    }
      // A transaction-scoped PostgreSQL lock serialises this logical key across
      // backend processes without weakening the active-row unique index.
      await manager.execute(
        `select pg_advisory_xact_lock(hashtextextended(?::text, 0))`,
        [`${input.provider}:${input.providerIdentifier}`]
      )
      if (input.tradingCardVariantId) {
        const [variant] = await manager.execute<{ trading_card_id: string }>(
          `select trading_card_id from trading_card_variant where id = ? and deleted_at is null`, [input.tradingCardVariantId]
        )
        if (!variant || variant.trading_card_id !== input.tradingCardId) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "External reference variant does not belong to the trading card")
        }
      }
      if (!input.tradingCardId && !input.cardSetId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "An external reference needs a trading card or card set")
      const [current] = await manager.execute<Record<string, unknown>>(
        `select *, xmin::text as version from trading_card_external_reference where provider = ? and provider_identifier = ?
         and deleted_at is null for update`, [input.provider, input.providerIdentifier]
      )
      const next = {
        trading_card_id: input.tradingCardId || null, card_set_id: input.cardSetId ?? null, trading_card_variant_id: input.tradingCardVariantId ?? null,
        provider: input.provider, provider_identifier: input.providerIdentifier, language: input.language ?? null,
        region: input.region ?? null, raw_payload_note: input.rawPayloadNote ?? null,
        provenance: input.provenance ?? EXTERNAL_REFERENCE_PROVENANCE.AUTOMATIC,
      }
      if (current?.provenance === EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL && next.provenance !== EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL &&
        current.trading_card_id === next.trading_card_id && (current.card_set_id ?? null) === next.card_set_id) return current
      if (current?.provenance === EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL && next.provenance === EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL &&
        current.trading_card_id === next.trading_card_id && (current.card_set_id ?? null) === next.card_set_id) return current
      if (current?.provenance === EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL && next.provenance !== EXTERNAL_REFERENCE_PROVENANCE.TRUSTED_MANUAL) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Trusted manual external reference cannot be overwritten automatically")
      }
      const id = (current?.id as string | undefined) ?? generateEntityId(undefined, "tcref")
      if (current) {
        const currentComparable = {
          trading_card_id: current.trading_card_id,
          card_set_id: current.card_set_id ?? null,
          trading_card_variant_id: current.trading_card_variant_id ?? null,
          provider: current.provider,
          provider_identifier: current.provider_identifier,
          language: current.language ?? null,
          region: current.region ?? null,
          raw_payload_note: current.raw_payload_note ?? null,
          provenance: current.provenance ?? EXTERNAL_REFERENCE_PROVENANCE.AUTOMATIC,
        }
        if (JSON.stringify(currentComparable) === JSON.stringify(next)) return current
        if (!input.referenceId || input.referenceId !== current.id || !input.expectedVersion) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "External reference already exists with different data; its reference ID and version are required for an update"
          )
        }
        if (input.expectedVersion !== current.version) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "External reference changed before this update")
        }
        await manager.execute(
          `update trading_card_external_reference set trading_card_id = ?, card_set_id = ?, trading_card_variant_id = ?, language = ?,
           region = ?, raw_payload_note = ?, provenance = ?, updated_at = now() where id = ?`,
          [next.trading_card_id, next.card_set_id, next.trading_card_variant_id, next.language, next.region, next.raw_payload_note, next.provenance, id]
        )
      } else {
        await manager.execute(
          `insert into trading_card_external_reference
           (id, trading_card_id, card_set_id, trading_card_variant_id, provider, provider_identifier, language, region, raw_payload_note, provenance)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, next.trading_card_id, next.card_set_id, next.trading_card_variant_id, next.provider, next.provider_identifier, next.language, next.region, next.raw_payload_note, next.provenance]
        )
      }
      const currentAudit = current ? externalReferenceAuditState(current) : undefined
      const nextAudit = externalReferenceAuditState(next)
      const changedKeys = currentAudit
        ? Object.keys(nextAudit).filter((key) => currentAudit[key as keyof typeof currentAudit] !== nextAudit[key as keyof typeof nextAudit])
        : []
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.EXTERNAL_CARD_REFERENCE, entityId: id,
        action: current ? AUDIT_ACTION.EXTERNAL_REFERENCE_CHANGED : AUDIT_ACTION.EXTERNAL_REFERENCE_ADDED,
        oldValue: currentAudit && Object.fromEntries(changedKeys.map((key) => [key, currentAudit[key as keyof typeof currentAudit]])),
        newValue: currentAudit
          ? Object.fromEntries(changedKeys.map((key) => [key, nextAudit[key as keyof typeof nextAudit]]))
          : nextAudit,
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select *, xmin::text as version from trading_card_external_reference where id = ? and deleted_at is null`, [id]
      )
      return saved
  }

  async removeExternalReference(input: AuditContext & { id: string }) {
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_external_reference where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "External card reference not found")
      await manager.execute(`update trading_card_external_reference set deleted_at = now(), updated_at = now() where id = ?`, [input.id])
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.EXTERNAL_CARD_REFERENCE, entityId: input.id,
        action: AUDIT_ACTION.EXTERNAL_REFERENCE_REMOVED, oldValue: externalReferenceAuditState(current),
      })
    })
  }
}

export default TradingCardsModuleService
