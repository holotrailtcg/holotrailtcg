import { generateEntityId, MedusaError, MedusaService } from "@medusajs/framework/utils"
import CardSet from "./models/card-set"
import TradingCard from "./models/trading-card"
import TradingCardVariant from "./models/trading-card-variant"
import ExternalCardReference from "./models/external-card-reference"
import CardAuditEntry from "./models/card-audit-entry"
import RarityMapping from "./models/rarity-mapping"
import ProviderSetMapping from "./models/provider-set-mapping"
import TcgDexLookupCandidate from "./models/tcgdex-lookup-candidate"
import TcgDexEnrichmentProposal from "./models/tcgdex-enrichment-proposal"
import TcgDexEnrichmentAttempt from "./models/tcgdex-enrichment-attempt"
import CardImage from "./models/card-image"
import { cardNumberForms, normaliseCardNumberComparisonForm, normaliseComparisonText } from "./identity/card-number"
import { rarityComparisonForm } from "./rarity/normalise-rarity"
import {
  AUDIT_ACTION, AUDIT_ENTITY_TYPE, type CardCondition, type CardFinish, type CardGame,
  type CardLanguage, type ConditionSource, type ExternalProvider, RECORD_ORIGIN, type RecordOrigin, type SpecialTreatment,
  EXTERNAL_PROVIDER, EXTERNAL_REFERENCE_PROVENANCE, type ExternalReferenceProvenance, IMAGE_STATUS,
  MAX_CARD_IMAGE_BYTE_SIZE, CARD_IMAGE_UPLOAD_EXPIRY_MINUTES, CARD_IMAGE_CLEANUP_ACTOR, SUPPORTED_IMAGE_MIME_TYPES,
} from "./types"
import { generateStagingObjectKey, generateFinalObjectKey, sanitiseOriginalFilename, derivePublicImageUrl } from "./images/object-keys"
import type { R2ImageStorageClient } from "./images/r2-client"
import { expiresAtFromNow } from "./images/r2-client"
import { processCardImageUpload } from "./images/image-processing"
import { acquirePrefixReconciliationLock } from "./images/orphan-reconciliation-lock"
import { runOrphanReconciliation, type OrphanReconciliationCounts } from "./images/orphan-reconciliation"
import type { TcgDexMatchInput, TcgDexMatchResult } from "./tcgdex/matching-types"
import type { TcgDexLookupDependency } from "./tcgdex/matching"
import { matchTcgdexCard } from "./tcgdex/matching"
import { auditContextSchema, canonicalSnapshot, diagnosticFingerprint, enrichmentSnapshotSchema, providerIdentifierSchema, pulseProviderIdentifierSchema, snapshotFingerprint, tcgdexMatchResultSchema, tradingCardIdSchema } from "./tcgdex/persistence-validation"
import {
  listTcgdexAttempts,
  listTcgdexReviews,
  retrieveTcgdexAttempt,
  retrieveTcgdexReview,
  type AttemptListQuery,
  type ReviewListQuery,
} from "./tcgdex/admin-review"
import {
  listCardsNeedingImages,
  listThumbnailsForVariants,
  retrieveCardImageDetail,
  type ImageListQuery,
} from "./images/admin-image-review"

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

export interface CreatePendingCardImageInput extends AuditContext {
  tradingCardVariantId: string
  uploadedBy: string
  originalFilename: string
  declaredMimeType: string
  declaredByteSize: number
}

export interface BeginCardImageUploadInput extends AuditContext {
  tradingCardVariantId: string
  uploadedBy: string
  originalFilename: string
  declaredMimeType: string
  declaredByteSize: number
  r2Client: R2ImageStorageClient
}

export interface ConfirmPendingCardImageInput extends AuditContext {
  id: string
  r2Client: R2ImageStorageClient
}

export interface ReconcileOrphanedImageObjectsInput {
  r2Client: R2ImageStorageClient
  prefix: string
  graceCutoff: Date
  dryRun: boolean
  maxObjectsPerRun: number
  /** Used only to open the dedicated advisory-lock connection; never logged. */
  databaseUrl: string
}

export interface ReorderReadyCardImagesInput extends AuditContext {
  tradingCardVariantId: string
  orderedImageIds: string[]
}

export interface ArchiveCardImageInput extends AuditContext {
  id: string
  adminId: string
}

export interface UpdateCardImageFocalPointInput extends AuditContext {
  id: string
  focalX: number
  focalY: number
}

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
  TcgDexEnrichmentProposal, TcgDexEnrichmentAttempt, CardImage, ProviderSetMapping, TcgDexLookupCandidate,
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

  // CardImage rows may only be mutated through the explicit domain methods
  // below (createPendingCardImage/reorderReadyCardImages/archiveCardImage/
  // restoreCardImage), which lock the owning variant row and keep READY
  // sort order contiguous. The generated bulk mutation methods would let a
  // caller bypass that locking and the lifecycle-key CHECK constraint's
  // implicit workflow entirely, so every one of them is blocked here; only
  // the generated read methods (listCardImages/retrieveCardImage/etc.)
  // remain usable.
  createCardImages = async (): Promise<never> => this.lifecycleMutationBlocked("Card image creation")
  updateCardImages = async (): Promise<never> => this.lifecycleMutationBlocked("Card image updates")
  deleteCardImages = async (): Promise<never> => this.lifecycleMutationBlocked("Card image deletion")
  softDeleteCardImages = async (): Promise<never> => this.lifecycleMutationBlocked("Card image deletion")
  restoreCardImages = async (): Promise<never> => this.lifecycleMutationBlocked("Card image restoration")

  async listTcgdexAdminReviews(query: ReviewListQuery) {
    return listTcgdexReviews(this.manager_, query)
  }

  async retrieveTcgdexAdminReview(proposalId: string) {
    return retrieveTcgdexReview(this.manager_, proposalId)
  }

  async listTcgdexAdminAttempts(query: AttemptListQuery) {
    return listTcgdexAttempts(this.manager_, query)
  }

  async retrieveTcgdexAdminAttempt(attemptId: string) {
    return retrieveTcgdexAttempt(this.manager_, attemptId)
  }

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

  /**
   * Re-runs the Stage 4A.2 matcher for a trading card using only trusted,
   * database-held identity: a card-set TCGdex set code, plus any
   * TRUSTED_MANUAL external reference recorded for the set or the card
   * itself. Never accepts a provider identifier from the caller. The
   * network call happens outside any transaction; the result is then
   * persisted through the existing `recordTcgdexMatchResult` idempotency
   * rules.
   */
  async retryTcgdexEnrichmentMatch(input: AuditContext & { tradingCardId: string; client: TcgDexLookupDependency }) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    tradingCardIdSchema.parse(input.tradingCardId)
    const [card] = await this.manager_.execute<Record<string, unknown>>(
      `select tc.id, tc.name, tc.card_number, tc.card_set_id, cs.language as set_language, cs.provider_set_code
       from trading_card tc inner join trading_card_set cs on cs.id = tc.card_set_id and cs.deleted_at is null
       where tc.id = ? and tc.deleted_at is null`,
      [input.tradingCardId]
    )
    if (!card) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card not found")
    const [setReference] = await this.manager_.execute<Record<string, unknown>>(
      `select provider_identifier from trading_card_external_reference
       where card_set_id = ? and provider = 'TCGDEX' and provenance = 'TRUSTED_MANUAL'
         and provider_identifier like 'SET:%' and deleted_at is null limit 1`,
      [card.card_set_id]
    )
    const [cardReference] = await this.manager_.execute<Record<string, unknown>>(
      `select provider_identifier from trading_card_external_reference
       where trading_card_id = ? and provider = 'TCGDEX' and provenance = 'TRUSTED_MANUAL' and deleted_at is null limit 1`,
      [input.tradingCardId]
    )
    const trustedSetId = setReference ? String(setReference.provider_identifier).slice(4) : String(card.provider_set_code)
    const matchInput: TcgDexMatchInput = {
      language: card.set_language as TcgDexMatchInput["language"],
      setCode: String(card.provider_set_code),
      cardNumber: card.card_number as string,
      cardName: card.name as string,
      setIdentity: { tcgdexSetId: trustedSetId },
      ...(cardReference
        ? { manualCardReference: { provider: "TCGDEX" as const, providerIdentifier: String(cardReference.provider_identifier) } }
        : {}),
    }
    const result = await matchTcgdexCard(matchInput, input.client)
    const record = await this.recordTcgdexMatchResult({
      actor: input.actor, source: "TCGDEX", reason: input.reason, tradingCardId: input.tradingCardId, result,
    })
    return { code: result.code, id: record.id as string }
  }

  /**
   * Stage 5B.1: read-only half of the Pulse matcher's `TradingCardMatchLookup`
   * contract (see `trading-card-inventory/pulse/matching.ts`) — an existing
   * trusted `ExternalCardReference(provider=PULSE)`, if any. A thin explicit
   * method rather than exposing generated CRUD to a cross-module caller.
   */
  async findTrustedExternalReference(provider: ExternalProvider, providerIdentifier: string) {
    const identifierSchema = provider === EXTERNAL_PROVIDER.PULSE ? pulseProviderIdentifierSchema : providerIdentifierSchema
    const normalizedIdentifier = identifierSchema.parse(providerIdentifier)
    const [reference] = await this.manager_.execute<Record<string, unknown>>(
      `select trading_card_id, trading_card_variant_id from trading_card_external_reference
       where provider = ? and provider_identifier = ? and provenance = 'TRUSTED_MANUAL' and deleted_at is null`,
      [provider, normalizedIdentifier],
    )
    if (!reference || !reference.trading_card_id) return null
    return {
      tradingCardId: reference.trading_card_id as string,
      tradingCardVariantId: (reference.trading_card_variant_id as string | null) ?? null,
    }
  }

  /**
   * Stage 5B.1: the other half of `TradingCardMatchLookup` — candidate
   * variants for a card identified by (set code, card number, language)
   * matching the row's exact commercial attributes. Set code and language
   * are compared exactly, per ADR 0007 (never parsed/fuzzy-matched).
   *
   * Card number comparison matches against BOTH the current
   * `normaliseCardNumberComparisonForm` shape (denominator-stripped,
   * uppercase-folded — what every writer produces once
   * `Migration20260718160000` has run) AND the pre-Phase-8 legacy shape
   * (trim+NFC only, denominator and case preserved — what every row written
   * before that migration still has until it runs). This is a deliberate,
   * temporary compatibility fallback, not deployment-ordering trust: a
   * literal `card_number_normalised = ?` SQL comparison against only the new
   * form returns zero rows for a row that has not yet been migrated
   * (verified directly — see "findVariantCandidatesForPulseMatch finds
   * NOTHING for a genuinely unmigrated legacy row" in
   * trading-cards-module.spec.ts), so relying on migration-before-boot
   * ordering alone would leave a real window where existing catalogue cards
   * become invisible to Pulse matching. Remove the legacy branch once
   * Migration20260718160000 is confirmed applied in every environment that
   * matters (dev, test, and — once it exists — production) and no
   * `card_number_normalised` value in any of them differs from
   * `normaliseCardNumberComparisonForm(card_number_normalised)`.
   */
  async findVariantCandidatesForPulseMatch(input: {
    setCodeCandidate: string; cardNumberCandidate: string; language: string; condition: string; finish: string; specialTreatment: string
  }) {
    const currentForm = normaliseCardNumberComparisonForm(input.cardNumberCandidate)
    const legacyForm = normaliseComparisonText(input.cardNumberCandidate)
    // Pulse candidates are already denominator-inclusive text (e.g.
    // "044/072"), so `currentForm` and `legacyForm` normally differ; only
    // dedupe the parameter list for the rare case they coincide (a card
    // number with no denominator and no letters to case-fold).
    const cardNumberCandidates = [...new Set([currentForm, legacyForm])]
    const rows = await this.manager_.execute<{ id: string; trading_card_id: string }>(
      `select tcv.id, tcv.trading_card_id from trading_card_variant tcv
       inner join trading_card tc on tc.id = tcv.trading_card_id and tc.deleted_at is null
       inner join trading_card_set cs on cs.id = tc.card_set_id and cs.deleted_at is null
       where cs.provider_set_code = ? and cs.language = ? and tc.card_number_normalised in (${cardNumberCandidates.map(() => "?").join(", ")})
         and tcv.condition = ? and tcv.finish = ? and tcv.special_treatment = ? and tcv.deleted_at is null`,
      [input.setCodeCandidate, input.language, ...cardNumberCandidates, input.condition, input.finish, input.specialTreatment],
    )
    return rows.map((row) => ({ id: row.id, tradingCardId: row.trading_card_id }))
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
      const searchName = snapshot.name.toLocaleLowerCase()
      if (card.name !== snapshot.name) { assignments.push("name = ?"); values.push(snapshot.name); changedFields.push("name") }
      if (card.search_name !== searchName) { assignments.push("search_name = ?"); values.push(searchName); changedFields.push("search_name") }
      if (snapshot.rarityCandidate?.status === "MAPPED") {
        const rarityFields = [
          ["rarity", snapshot.rarityCandidate.rarity, card.rarity],
          ["rarity_icon_key", snapshot.rarityCandidate.iconKey, card.rarity_icon_key],
          ["rarity_raw", snapshot.rarityCandidate.providerValue, card.rarity_raw],
          ["rarity_comparison", rarityComparisonForm(snapshot.rarityCandidate.providerValue), card.rarity_comparison],
        ] as const
        for (const [field, nextValue, currentValue] of rarityFields) {
          if (currentValue !== nextValue) {
            assignments.push(`${field} = ?`)
            values.push(nextValue)
            changedFields.push(field)
          }
        }
      }
      if (assignments.length) await manager.execute(`update trading_card set ${assignments.join(", ")}, updated_at = now() where id = ?`, [...values, card.id])
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

  async findProviderSetMapping(input: { provider: ExternalProvider; game: CardGame; language: CardLanguage; providerSetCode: string }) {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_provider_set_mapping
       where provider = ? and game = ? and language = ? and provider_set_code = ? and deleted_at is null`,
      [input.provider, input.game, input.language, input.providerSetCode]
    )
    return row ?? null
  }

  /**
   * Confirms a mapping from one provider's own set code to a real TCGdex set
   * id. The caller (API layer) is responsible for verifying the TCGdex id
   * actually exists via a live lookup before calling this — this method only
   * persists the confirmed result, it never talks to TCGdex itself.
   */
  async createProviderSetMapping(input: {
    provider: ExternalProvider; game: CardGame; language: CardLanguage
    providerSetCode: string; tcgdexSetId: string; tcgdexSetName: string
    tcgdexSeriesId: string; tcgdexSeriesName: string
  }) {
    const existing = await this.findProviderSetMapping(input)
    if (existing) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This provider set code is already mapped")
    }
    const id = generateEntityId(undefined, "tcpsm")
    await this.manager_.execute(
      `insert into trading_card_provider_set_mapping
         (id, provider, game, language, provider_set_code, tcgdex_set_id, tcgdex_set_name, tcgdex_series_id, tcgdex_series_name)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.provider, input.game, input.language, input.providerSetCode, input.tcgdexSetId, input.tcgdexSetName,
        input.tcgdexSeriesId, input.tcgdexSeriesName,
      ]
    )
    return this.findProviderSetMapping(input)
  }

  async retrieveTcgdexLookupCandidateById(id: string) {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_tcgdex_lookup_candidate where id = ? and deleted_at is null`, [id]
    )
    return row ?? null
  }

  async findTcgdexLookupCandidate(input: { provider: ExternalProvider; language: CardLanguage; tcgdexSetId: string; cardNumber: string }) {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_tcgdex_lookup_candidate
       where provider = ? and language = ? and tcgdex_set_id = ? and card_number = ? and deleted_at is null`,
      [input.provider, input.language, input.tcgdexSetId, input.cardNumber]
    )
    return row ?? null
  }

  /**
   * Caches one TCGdex lookup outcome, keyed by exact card identity — never
   * called for `PROVIDER_ERROR` (a transient failure must be retried, not
   * remembered as a stable result; the caller is responsible for not
   * caching it). Idempotent: a second call for the same identity is a
   * harmless no-op, returning the first-ever recorded result rather than
   * overwriting it, since the whole point is that a card's TCGdex identity
   * never legitimately changes.
   */
  async recordTcgdexLookupCandidate(input: {
    provider: ExternalProvider; language: CardLanguage; tcgdexSetId: string; cardNumber: string
    matchOutcome: "MATCHED" | "NO_MATCH" | "UNRESOLVED_SET" | "IDENTITY_MISMATCH"
    enrichment?: Record<string, unknown> | null
  }) {
    const existing = await this.findTcgdexLookupCandidate(input)
    if (existing) return existing
    const id = generateEntityId(undefined, "tclookup")
    const reviewStatus = input.matchOutcome === "MATCHED" ? "PENDING" : null
    await this.manager_.execute(
      `insert into trading_card_tcgdex_lookup_candidate
         (id, provider, language, tcgdex_set_id, card_number, match_outcome, enrichment, review_status)
       values (?, ?, ?, ?, ?, ?, ?::jsonb, ?)
       on conflict (provider, language, tcgdex_set_id, card_number) where deleted_at is null do nothing`,
      [id, input.provider, input.language, input.tcgdexSetId, input.cardNumber, input.matchOutcome,
        input.enrichment ? JSON.stringify(input.enrichment) : null, reviewStatus]
    )
    return this.findTcgdexLookupCandidate(input)
  }

  /** Batch existence check for a set of exact card identities — used to skip already-cached lookups before spending a live TCGdex call. */
  async listTcgdexLookupCandidates(input: {
    provider: ExternalProvider; language: CardLanguage; keys: Array<{ tcgdexSetId: string; cardNumber: string }>
  }) {
    if (input.keys.length === 0) return []
    const placeholders = input.keys.map(() => `(?, ?)`).join(", ")
    const params = input.keys.flatMap((key) => [key.tcgdexSetId, key.cardNumber])
    return this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_tcgdex_lookup_candidate
       where provider = ? and language = ? and deleted_at is null
         and (tcgdex_set_id, card_number) in (${placeholders})`,
      [input.provider, input.language, ...params]
    )
  }

  async reviewTcgdexLookupCandidates(input: { ids: string[]; reviewStatus: "ACCEPTED" | "REJECTED" }) {
    if (input.ids.length === 0) return
    const placeholders = input.ids.map(() => "?").join(", ")
    await this.manager_.execute(
      `update trading_card_tcgdex_lookup_candidate set review_status = ?, updated_at = now()
       where id in (${placeholders}) and match_outcome = 'MATCHED' and review_status = 'PENDING' and deleted_at is null`,
      [input.reviewStatus, ...input.ids]
    )
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
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const identifierSchema = input.provider === EXTERNAL_PROVIDER.PULSE ? pulseProviderIdentifierSchema : providerIdentifierSchema
    const providerIdentifier = identifierSchema.parse(input.providerIdentifier)
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
        [`${input.provider}:${providerIdentifier}`]
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
         and deleted_at is null for update`, [input.provider, providerIdentifier]
      )
      const next = {
        trading_card_id: input.tradingCardId || null, card_set_id: input.cardSetId ?? null, trading_card_variant_id: input.tradingCardVariantId ?? null,
        provider: input.provider, provider_identifier: providerIdentifier, language: input.language ?? null,
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

  /**
   * Locks the owning trading-card variant row for the duration of the
   * caller's transaction. Every `CardImage` mutation below locks its
   * variant first (in this same order) so concurrent image mutations on the
   * same variant serialise instead of racing on sort-order bookkeeping.
   */
  private async lockCardImageVariant(manager: TxManager, id: string) {
    const [variant] = await manager.execute<Record<string, unknown>>(
      `select id from trading_card_variant where id = ? and deleted_at is null for update`, [id]
    )
    if (!variant) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card variant not found")
    return variant
  }

  async assertCardImageVariantOwnership(input: { imageVariantId: string; expectedVariantId: string }): Promise<void> {
    if (input.imageVariantId !== input.expectedVariantId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Card image does not belong to the expected trading-card variant"
      )
    }
  }

  async deriveCardImagePublicUrl(input: { publicBaseUrl: string; objectKey: string }): Promise<string> {
    return derivePublicImageUrl(input.publicBaseUrl, input.objectKey)
  }

  async listCardImagesForVariant(input: { tradingCardVariantId: string; includeArchived?: boolean }) {
    const query = input.includeArchived
      ? `select * from trading_card_image where trading_card_variant_id = ? and deleted_at is null order by sort_order asc`
      : `select * from trading_card_image where trading_card_variant_id = ? and status <> 'ARCHIVED' and deleted_at is null order by sort_order asc`
    return this.manager_.execute<Record<string, unknown>>(query, [input.tradingCardVariantId])
  }

  async createPendingCardImage(input: CreatePendingCardImageInput) {
    if (!Number.isInteger(input.declaredByteSize) || input.declaredByteSize <= 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "declaredByteSize must be a positive integer")
    }
    if (input.declaredByteSize > MAX_CARD_IMAGE_BYTE_SIZE) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `declaredByteSize must not exceed ${MAX_CARD_IMAGE_BYTE_SIZE} bytes`
      )
    }
    if (!(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(input.declaredMimeType)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `declaredMimeType must be one of ${SUPPORTED_IMAGE_MIME_TYPES.join(", ")}`
      )
    }
    return this.manager_.transactional(async (manager) => {
      await this.lockCardImageVariant(manager, input.tradingCardVariantId)
      const [{ count }] = await manager.execute<{ count: string }>(
        `select count(*)::int as count from trading_card_image
         where trading_card_variant_id = ? and status = ? and deleted_at is null`,
        [input.tradingCardVariantId, IMAGE_STATUS.READY]
      )
      const sortOrder = Number(count)
      const id = generateEntityId(undefined, "tcimg")
      const stagingObjectKey = generateStagingObjectKey({
        variantId: input.tradingCardVariantId, imageId: id, mimeType: input.declaredMimeType,
      })
      const originalFilename = sanitiseOriginalFilename(input.originalFilename)
      // Server-computed, never caller-supplied: an upload window the caller
      // controlled would let a client keep its own PENDING row alive
      // indefinitely.
      const uploadExpiresAt = expiresAtFromNow(CARD_IMAGE_UPLOAD_EXPIRY_MINUTES)
      await manager.execute(
        `insert into trading_card_image
         (id, trading_card_variant_id, status, staging_object_key, original_filename,
          declared_mime_type, declared_byte_size, sort_order, uploaded_by, upload_expires_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.tradingCardVariantId, IMAGE_STATUS.PENDING, stagingObjectKey, originalFilename,
          input.declaredMimeType, input.declaredByteSize, sortOrder, input.uploadedBy, uploadExpiresAt,
        ]
      )
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.CARD_IMAGE, entityId: id,
        action: AUDIT_ACTION.IMAGE_UPLOAD_REQUESTED,
        newValue: {
          tradingCardVariantId: input.tradingCardVariantId, declaredMimeType: input.declaredMimeType,
          declaredByteSize: input.declaredByteSize, sortOrder, stagingObjectKey,
        },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_image where id = ? and deleted_at is null`, [id]
      )
      return saved
    })
  }

  async reorderReadyCardImages(input: ReorderReadyCardImagesInput) {
    return this.manager_.transactional(async (manager) => {
      await this.lockCardImageVariant(manager, input.tradingCardVariantId)
      const current = await manager.execute<Record<string, unknown>>(
        `select id, trading_card_variant_id, sort_order from trading_card_image
         where trading_card_variant_id = ? and status = ? and deleted_at is null
         order by sort_order asc for update`,
        [input.tradingCardVariantId, IMAGE_STATUS.READY]
      )
      const currentIds = current.map((row) => row.id as string)
      const requestedIds = input.orderedImageIds
      const isExactRearrangement =
        requestedIds.length === currentIds.length &&
        new Set(requestedIds).size === requestedIds.length &&
        currentIds.every((id) => requestedIds.includes(id))
      if (!isExactRearrangement) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Reorder must include exactly the current ready images for this variant, each exactly once"
        )
      }
      for (const row of current) {
        await this.assertCardImageVariantOwnership({
          imageVariantId: row.trading_card_variant_id as string, expectedVariantId: input.tradingCardVariantId,
        })
      }
      const oldOrder = current.map((row) => row.id as string)
      // Two-phase update: land every row on a disjoint high placeholder first so a
      // mid-transaction swap never collides with the unique active-sort-order index.
      for (let index = 0; index < requestedIds.length; index++) {
        await manager.execute(`update trading_card_image set sort_order = ?, updated_at = now() where id = ?`, [
          requestedIds.length + index, requestedIds[index],
        ])
      }
      for (let index = 0; index < requestedIds.length; index++) {
        await manager.execute(`update trading_card_image set sort_order = ?, updated_at = now() where id = ?`, [
          index, requestedIds[index],
        ])
      }
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.CARD_IMAGE, entityId: input.tradingCardVariantId,
        action: AUDIT_ACTION.IMAGE_REORDERED, oldValue: { order: oldOrder }, newValue: { order: requestedIds },
      })
      return manager.execute<Record<string, unknown>>(
        `select * from trading_card_image where trading_card_variant_id = ? and status = ? and deleted_at is null order by sort_order asc`,
        [input.tradingCardVariantId, IMAGE_STATUS.READY]
      )
    })
  }

  async archiveCardImage(input: ArchiveCardImageInput) {
    return this.manager_.transactional(async (manager) => {
      const [target] = await manager.execute<Record<string, unknown>>(
        `select trading_card_variant_id from trading_card_image where id = ? and deleted_at is null`, [input.id]
      )
      if (!target) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
      await this.lockCardImageVariant(manager, target.trading_card_variant_id as string)
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_image where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
      if (current.status === IMAGE_STATUS.ARCHIVED) return current
      if (current.status !== IMAGE_STATUS.READY) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only a ready image can be archived")
      }
      const siblings = await manager.execute<Record<string, unknown>>(
        `select id, sort_order from trading_card_image
         where trading_card_variant_id = ? and status = ? and deleted_at is null
         order by sort_order asc for update`,
        [current.trading_card_variant_id, IMAGE_STATUS.READY]
      )
      await manager.execute(
        `update trading_card_image set status = ?, archived_at = now(), archived_by = ?, updated_at = now() where id = ?`,
        [IMAGE_STATUS.ARCHIVED, input.adminId, input.id]
      )
      const remaining = siblings.filter((row) => row.id !== input.id)
      for (let index = 0; index < remaining.length; index++) {
        if (remaining[index].sort_order !== index) {
          await manager.execute(`update trading_card_image set sort_order = ?, updated_at = now() where id = ?`, [
            index, remaining[index].id,
          ])
        }
      }
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.CARD_IMAGE, entityId: input.id,
        action: AUDIT_ACTION.IMAGE_ARCHIVED,
        oldValue: { status: current.status, sortOrder: current.sort_order },
        newValue: { status: IMAGE_STATUS.ARCHIVED, archivedBy: input.adminId },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_image where id = ?`, [input.id])
      return saved
    })
  }

  async restoreCardImage(input: AuditContext & { id: string }) {
    return this.manager_.transactional(async (manager) => {
      const [target] = await manager.execute<Record<string, unknown>>(
        `select trading_card_variant_id from trading_card_image where id = ? and deleted_at is null`, [input.id]
      )
      if (!target) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
      await this.lockCardImageVariant(manager, target.trading_card_variant_id as string)
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_image where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
      if (current.status !== IMAGE_STATUS.ARCHIVED) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only an archived image can be restored")
      }
      const [{ count }] = await manager.execute<{ count: string }>(
        `select count(*)::int as count from trading_card_image
         where trading_card_variant_id = ? and status = ? and deleted_at is null`,
        [current.trading_card_variant_id, IMAGE_STATUS.READY]
      )
      const sortOrder = Number(count)
      await manager.execute(
        `update trading_card_image set status = ?, archived_at = null, archived_by = null, sort_order = ?, updated_at = now() where id = ?`,
        [IMAGE_STATUS.READY, sortOrder, input.id]
      )
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.CARD_IMAGE, entityId: input.id,
        action: AUDIT_ACTION.IMAGE_RESTORED,
        oldValue: { status: current.status },
        newValue: { status: IMAGE_STATUS.READY, sortOrder },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_image where id = ?`, [input.id])
      return saved
    })
  }

  /**
   * Focal position only ever applies to an active (READY) photograph — an
   * archived image has no gallery position to focus, and a pending/terminal
   * row has no confirmed pixels yet. The 0..1 bounds check here duplicates
   * the `CK_trading_card_image_focal_bounds` database constraint so a bad
   * value gets a specific `INVALID_DATA` error instead of a raw constraint
   * violation.
   */
  async updateCardImageFocalPoint(input: UpdateCardImageFocalPointInput) {
    if (input.focalX < 0 || input.focalX > 1 || input.focalY < 0 || input.focalY > 1) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "focalX and focalY must be between 0 and 1")
    }
    return this.manager_.transactional(async (manager) => {
      const [target] = await manager.execute<Record<string, unknown>>(
        `select trading_card_variant_id from trading_card_image where id = ? and deleted_at is null`, [input.id]
      )
      if (!target) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
      await this.lockCardImageVariant(manager, target.trading_card_variant_id as string)
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_image where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
      if (current.status !== IMAGE_STATUS.READY) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only a ready image's focal point can be changed")
      }
      await manager.execute(
        `update trading_card_image set focal_x = ?, focal_y = ?, updated_at = now() where id = ?`,
        [input.focalX, input.focalY, input.id]
      )
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.CARD_IMAGE, entityId: input.id,
        action: AUDIT_ACTION.IMAGE_FOCAL_CHANGED,
        oldValue: { focalX: current.focal_x, focalY: current.focal_y },
        newValue: { focalX: input.focalX, focalY: input.focalY },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_image where id = ?`, [input.id])
      return saved
    })
  }

  async listCardsNeedingImages(query: ImageListQuery) {
    return listCardsNeedingImages(this.manager_, query)
  }

  async retrieveCardImageDetail(tradingCardId: string) {
    return retrieveCardImageDetail(this.manager_, tradingCardId)
  }

  /** See `listThumbnailsForVariants` in `images/admin-image-review.ts`. */
  async listThumbnailsForVariants(input: { variantIds: string[]; publicBaseUrl: string | null }) {
    return listThumbnailsForVariants(
      this.manager_,
      input.variantIds,
      (objectKey) => input.publicBaseUrl ? derivePublicImageUrl(input.publicBaseUrl, objectKey) : null,
    )
  }

  /**
   * Requests a new upload target for a variant: creates the PENDING row
   * (via `createPendingCardImage`, unchanged) and then, outside any DB
   * transaction, asks R2 for a presigned PUT URL for its staging key. If
   * the presign call fails after the row is created, the row is simply
   * left to expire via the normal EXPIRED path later — no compensating
   * delete, consistent with this stage's "no synchronous cleanup"
   * principle everywhere else.
   */
  async beginCardImageUpload(input: BeginCardImageUploadInput) {
    if (!(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(input.declaredMimeType)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `declaredMimeType must be one of ${SUPPORTED_IMAGE_MIME_TYPES.join(", ")}`
      )
    }
    if (!Number.isInteger(input.declaredByteSize) || input.declaredByteSize <= 0 || input.declaredByteSize > MAX_CARD_IMAGE_BYTE_SIZE) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `declaredByteSize must be a positive integer not exceeding ${MAX_CARD_IMAGE_BYTE_SIZE} bytes`
      )
    }
    // Friendly pre-check for a fast, specific 404; createPendingCardImage's
    // own row lock is the authoritative existence check.
    await this.retrieveTradingCardVariant(input.tradingCardVariantId)

    const image = await this.createPendingCardImage({
      actor: input.actor, source: input.source, reason: input.reason,
      tradingCardVariantId: input.tradingCardVariantId, uploadedBy: input.uploadedBy,
      originalFilename: input.originalFilename, declaredMimeType: input.declaredMimeType,
      declaredByteSize: input.declaredByteSize,
    }) as Record<string, unknown>

    const presigned = await input.r2Client.createPresignedPutUrl({
      key: image.staging_object_key as string,
      contentType: input.declaredMimeType,
      expiresInSeconds: CARD_IMAGE_UPLOAD_EXPIRY_MINUTES * 60,
    })

    return { image, presigned }
  }

  private assertConfirmableStatus(status: string): void {
    if (status === IMAGE_STATUS.PENDING) return
    if (status === IMAGE_STATUS.DUPLICATE) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This upload was already confirmed as a duplicate of an existing image")
    }
    if (status === IMAGE_STATUS.READY || status === IMAGE_STATUS.ARCHIVED) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This upload has already been confirmed")
    }
    if (status === IMAGE_STATUS.REJECTED) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This upload was already rejected")
    }
    if (status === IMAGE_STATUS.EXPIRED) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This upload has expired")
    }
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This upload cannot be confirmed")
  }

  /**
   * Clears every staging/final key and confirmed-metadata column and moves
   * a `CardImage` row to one of the three terminal non-active statuses
   * (`REJECTED`/`EXPIRED`/`DUPLICATE`), which the
   * `CK_trading_card_image_lifecycle_keys` CHECK constraint treats
   * identically. Caller must already hold the row's `for update` lock.
   */
  private async transitionPendingCardImage(manager: TxManager, input: AuditContext & {
    id: string
    currentStatus: string
    target: "REJECTED" | "EXPIRED" | "DUPLICATE"
    action: string
    extraNewValue?: Record<string, unknown>
  }) {
    await manager.execute(
      `update trading_card_image set status = ?, staging_object_key = null, final_object_key = null,
       confirmed_mime_type = null, confirmed_byte_size = null, width = null, height = null, sha256_hash = null,
       updated_at = now() where id = ?`,
      [input.target, input.id]
    )
    await this.writeAudit(manager, {
      actor: input.actor, source: input.source, reason: input.reason,
      entityType: AUDIT_ENTITY_TYPE.CARD_IMAGE, entityId: input.id, action: input.action,
      oldValue: { status: input.currentStatus },
      newValue: { status: input.target, ...input.extraNewValue },
    })
    const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_image where id = ?`, [input.id])
    return saved
  }

  /**
   * Locks the variant + image row and transitions to a terminal status only
   * if the row is still `PENDING` — a no-op if a concurrent call already
   * moved it elsewhere, since `confirmPendingCardImage` throws its own
   * specific error immediately after calling this regardless of outcome.
   */
  private async performTerminalTransition(input: AuditContext & {
    id: string
    variantId: string
    target: "REJECTED" | "EXPIRED"
    action: string
    extraNewValue?: Record<string, unknown>
  }): Promise<void> {
    await this.manager_.transactional(async (manager) => {
      await this.lockCardImageVariant(manager, input.variantId)
      const [locked] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_image where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!locked || locked.status !== IMAGE_STATUS.PENDING) return
      await this.transitionPendingCardImage(manager, {
        actor: input.actor, source: input.source, reason: input.reason,
        id: input.id, currentStatus: locked.status as string, target: input.target, action: input.action,
        extraNewValue: input.extraNewValue,
      })
    })
  }

  /**
   * Confirms a PENDING upload: fetches the object from R2, validates it
   * (magic bytes via sharp's own format-sniffing, size), strips metadata,
   * auto-orients, re-encodes deterministically, hashes it, checks for a
   * per-variant duplicate, and transitions to READY/DUPLICATE/REJECTED/
   * EXPIRED accordingly. Every R2 call and the CPU-bound sharp pipeline run
   * outside any DB transaction; only the final status write (plus its
   * duplicate check, which must happen under the same variant lock) runs
   * inside one short transaction, mirroring every other CardImage method in
   * this class.
   */
  async confirmPendingCardImage(input: ConfirmPendingCardImageInput) {
    const [current] = await this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_image where id = ? and deleted_at is null`, [input.id]
    )
    if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
    this.assertConfirmableStatus(current.status as string)

    const variantId = current.trading_card_variant_id as string
    const declaredByteSize = current.declared_byte_size as number
    const currentExpiresAt = current.upload_expires_at ? new Date(current.upload_expires_at as string) : null
    if (currentExpiresAt && currentExpiresAt.getTime() < Date.now()) {
      await this.performTerminalTransition({
        actor: input.actor, source: input.source, reason: input.reason,
        id: input.id, variantId, target: "EXPIRED", action: AUDIT_ACTION.IMAGE_UPLOAD_EXPIRED,
      })
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This upload window has expired")
    }

    const fetched = await input.r2Client.getObject(current.staging_object_key as string)

    if (fetched.byteSize === 0) {
      await this.performTerminalTransition({
        actor: input.actor, source: input.source, reason: input.reason,
        id: input.id, variantId, target: "REJECTED", action: AUDIT_ACTION.IMAGE_UPLOAD_REJECTED,
        extraNewValue: { reason: "zero-byte-upload", declaredByteSize, actualByteSize: fetched.byteSize },
      })
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "The uploaded file was empty")
    }
    if (fetched.byteSize > MAX_CARD_IMAGE_BYTE_SIZE) {
      await this.performTerminalTransition({
        actor: input.actor, source: input.source, reason: input.reason,
        id: input.id, variantId, target: "REJECTED", action: AUDIT_ACTION.IMAGE_UPLOAD_REJECTED,
        extraNewValue: { reason: "oversized-upload", declaredByteSize, actualByteSize: fetched.byteSize },
      })
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `The uploaded file exceeds the ${MAX_CARD_IMAGE_BYTE_SIZE} byte limit`)
    }

    const processed = await processCardImageUpload(fetched.bytes)
    if (!processed.ok) {
      await this.performTerminalTransition({
        actor: input.actor, source: input.source, reason: input.reason,
        id: input.id, variantId, target: "REJECTED", action: AUDIT_ACTION.IMAGE_UPLOAD_REJECTED,
        extraNewValue: { reason: processed.reason, declaredByteSize, actualByteSize: fetched.byteSize },
      })
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        processed.reason.startsWith("unsupported-format")
          ? "The uploaded file is not a supported image format"
          : "The uploaded file is corrupted or not a readable image"
      )
    }

    const { result } = processed
    // Diagnostic-only: the server never trusts declared_byte_size for
    // anything security-relevant — only the fetched bytes matter — but a
    // large mismatch is recorded on the confirmation audit entry so it is
    // visible after the fact for troubleshooting.
    const sizeMismatch = { declaredByteSize, actualByteSize: fetched.byteSize }

    const finalObjectKey = generateFinalObjectKey({ variantId, imageId: input.id, mimeType: result.mimeType })
    await input.r2Client.putObject({
      key: finalObjectKey, body: result.buffer, contentType: result.mimeType, contentLength: result.byteSize,
    })

    // The transaction below must never throw for an *expected* outcome
    // (expiry) once it has already written that outcome's transition —
    // a thrown error rolls back everything in the same transaction,
    // including the EXPIRED write we just made. Instead it returns a
    // structured outcome; the public error (if any) is thrown only after
    // the transaction has committed, exactly like the pre-fetch expiry
    // check above (via `performTerminalTransition`) already does.
    const outcome = await this.manager_.transactional(async (manager): Promise<
      | { kind: "EXPIRED" }
      | { kind: "DUPLICATE" | "READY"; row: Record<string, unknown> }
    > => {
      await this.lockCardImageVariant(manager, variantId)
      const [locked] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_image where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!locked) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Card image not found")
      this.assertConfirmableStatus(locked.status as string)
      const lockedExpiresAt = locked.upload_expires_at ? new Date(locked.upload_expires_at as string) : null
      if (lockedExpiresAt && lockedExpiresAt.getTime() < Date.now()) {
        await this.transitionPendingCardImage(manager, {
          actor: input.actor, source: input.source, reason: input.reason,
          id: input.id, currentStatus: locked.status as string, target: "EXPIRED", action: AUDIT_ACTION.IMAGE_UPLOAD_EXPIRED,
        })
        return { kind: "EXPIRED" }
      }

      const [duplicate] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_image
         where trading_card_variant_id = ? and status = ? and sha256_hash = ? and deleted_at is null
         for update`,
        [variantId, IMAGE_STATUS.READY, result.sha256]
      )
      if (duplicate) {
        const row = await this.transitionPendingCardImage(manager, {
          actor: input.actor, source: input.source, reason: input.reason,
          id: input.id, currentStatus: locked.status as string, target: "DUPLICATE", action: AUDIT_ACTION.IMAGE_DUPLICATE_DETECTED,
          extraNewValue: { duplicateOfImageId: duplicate.id, ...sizeMismatch },
        })
        return { kind: "DUPLICATE", row: row as Record<string, unknown> }
      }

      const [{ count }] = await manager.execute<{ count: string }>(
        `select count(*)::int as count from trading_card_image
         where trading_card_variant_id = ? and status = ? and deleted_at is null`,
        [variantId, IMAGE_STATUS.READY]
      )
      const sortOrder = Number(count)
      await manager.execute(
        `update trading_card_image set status = ?, staging_object_key = null, final_object_key = ?,
         confirmed_mime_type = ?, confirmed_byte_size = ?, width = ?, height = ?, sha256_hash = ?,
         sort_order = ?, updated_at = now() where id = ?`,
        [
          IMAGE_STATUS.READY, finalObjectKey, result.mimeType, result.byteSize, result.width, result.height,
          result.sha256, sortOrder, input.id,
        ]
      )
      await this.writeAudit(manager, {
        actor: input.actor, source: input.source, reason: input.reason,
        entityType: AUDIT_ENTITY_TYPE.CARD_IMAGE, entityId: input.id, action: AUDIT_ACTION.IMAGE_UPLOAD_CONFIRMED,
        oldValue: { status: locked.status },
        newValue: {
          status: IMAGE_STATUS.READY, finalObjectKey, confirmedMimeType: result.mimeType,
          confirmedByteSize: result.byteSize, width: result.width, height: result.height, sortOrder, ...sizeMismatch,
        },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_image where id = ?`, [input.id])
      return { kind: "READY", row: saved }
    })

    if (outcome.kind === "EXPIRED") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This upload window has expired")
    }
    return outcome.row
  }

  /**
   * Stage 4B.4 hourly sweep: transitions up to `batchSize` `PENDING` rows
   * whose `upload_expires_at` is already past `cutoff` to `EXPIRED`, exactly
   * like the lazy confirm-time expiry path above. `for update skip locked`
   * means a row `confirmPendingCardImage` already holds a lock on is simply
   * skipped rather than raced or blocked on — it is picked up by a later
   * sweep once that confirm attempt finishes. This transition is never
   * gated by dry-run: an expired `PENDING` row is stale bookkeeping, not a
   * destructive delete, so the sweep always runs and always writes its
   * audit entries. Returns the ids transitioned, so the caller can loop
   * until a batch comes back smaller than `batchSize`.
   */
  async expirePendingCardImages(cutoff: Date, batchSize: number): Promise<string[]> {
    return this.manager_.transactional(async (manager) => {
      const candidates = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_image
         where status = ? and upload_expires_at < ? and deleted_at is null
         order by upload_expires_at asc
         limit ?
         for update skip locked`,
        [IMAGE_STATUS.PENDING, cutoff, batchSize]
      )
      const ids: string[] = []
      for (const row of candidates) {
        const id = row.id as string
        await this.transitionPendingCardImage(manager, {
          actor: CARD_IMAGE_CLEANUP_ACTOR, source: RECORD_ORIGIN.OTHER,
          id, currentStatus: IMAGE_STATUS.PENDING, target: "EXPIRED", action: AUDIT_ACTION.IMAGE_UPLOAD_EXPIRED,
        })
        ids.push(id)
      }
      return ids
    })
  }

  /**
   * Stage 4B.4 Slice 2: safely deletes orphaned R2 objects under one
   * managed prefix. Never mutates a `CardImage` row (only deletes an R2
   * object nothing references), so unlike the mutations above this writes
   * no audit entry — there is no row-level change to record. Guarded by a
   * non-blocking session-level advisory lock
   * (`images/orphan-reconciliation-lock.ts`) so overlapping runs for the
   * same prefix simply return zeroed counts rather than racing; staging and
   * final prefixes use independent lock keys and always run independently.
   * The list/check/delete loop itself never holds a MikroORM/Knex
   * transaction open — only plain, non-locking reference-check reads run
   * against the pooled connection, interleaved with R2 network calls.
   */
  async reconcileOrphanedImageObjects(input: ReconcileOrphanedImageObjectsInput): Promise<OrphanReconciliationCounts> {
    const lease = await acquirePrefixReconciliationLock(input.databaseUrl, input.prefix)
    if (!lease.acquired) {
      return { scanned: 0, retained: 0, wouldDelete: 0, deleted: 0, errors: 0, pagesProcessed: 0, limitReached: false }
    }
    try {
      return await runOrphanReconciliation({
        r2Client: input.r2Client,
        prefix: input.prefix,
        graceCutoff: input.graceCutoff,
        dryRun: input.dryRun,
        maxObjectsPerRun: input.maxObjectsPerRun,
        isReferenced: (key) => this.isCardImageKeyReferenced(key),
      })
    } finally {
      await lease.release()
    }
  }

  private async isCardImageKeyReferenced(key: string): Promise<boolean> {
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select 1 from trading_card_image
       where deleted_at is null and (staging_object_key = ? or final_object_key = ?)
       limit 1`,
      [key, key]
    )
    return rows.length > 0
  }
}

export default TradingCardsModuleService
