import { generateEntityId, MedusaError, MedusaService } from "@medusajs/framework/utils"
import CardSet from "./models/card-set"
import TradingCard from "./models/trading-card"
import TradingCardVariant from "./models/trading-card-variant"
import ExternalCardReference from "./models/external-card-reference"
import CardAuditEntry from "./models/card-audit-entry"
import RarityMapping from "./models/rarity-mapping"
import { cardNumberForms } from "./identity/card-number"
import { rarityComparisonForm } from "./rarity/normalise-rarity"
import {
  AUDIT_ACTION, AUDIT_ENTITY_TYPE, type CardCondition, type CardFinish,
  type CardLanguage, type ConditionSource, type ExternalProvider, type RecordOrigin, type SpecialTreatment,
} from "./types"

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
  tradingCardId: string
  tradingCardVariantId?: string | null
  provider: ExternalProvider
  providerIdentifier: string
  language?: CardLanguage | null
  region?: string | null
  rawPayloadNote?: string | null
}

class TradingCardsModuleService extends MedusaService({
  CardSet, TradingCard, TradingCardVariant, ExternalCardReference, CardAuditEntry, RarityMapping,
}) {
  protected manager_: EntityManager

  constructor(container: { manager: EntityManager }) {
    // @ts-ignore MedusaService's generated constructor accepts the module container.
    super(...arguments)
    this.manager_ = container.manager
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
      const [current] = await manager.execute<{ price_locked: boolean }>(
        `select price_locked from trading_card_variant where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card variant not found")
      if (!current.price_locked) {
        await manager.execute(
          `update trading_card_variant set price_locked = true, price_locked_at = now(), price_locked_actor = ?,
           price_lock_reason = ?, updated_at = now() where id = ?`, [input.actor, input.reason ?? null, input.id]
        )
        await this.writeAudit(manager, {
          ...input, entityType: AUDIT_ENTITY_TYPE.TRADING_CARD_VARIANT, entityId: input.id,
          action: AUDIT_ACTION.PRICE_LOCKED, oldValue: { price_locked: false }, newValue: { price_locked: true },
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
      const [current] = await manager.execute<{ price_locked: boolean }>(
        `select price_locked from trading_card_variant where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card variant not found")
      if (current.price_locked) {
        await manager.execute(
          `update trading_card_variant set price_locked = false, price_locked_at = null, price_locked_actor = null,
           price_lock_reason = null, updated_at = now() where id = ?`, [input.id]
        )
        await this.writeAudit(manager, {
          ...input, entityType: AUDIT_ENTITY_TYPE.TRADING_CARD_VARIANT, entityId: input.id,
          action: AUDIT_ACTION.PRICE_UNLOCKED, oldValue: { price_locked: true }, newValue: { price_locked: false },
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

  async upsertExternalReference(input: UpsertExternalReferenceInput) {
    return this.manager_.transactional(async (manager) => {
      if (input.tradingCardVariantId) {
        const [variant] = await manager.execute<{ trading_card_id: string }>(
          `select trading_card_id from trading_card_variant where id = ? and deleted_at is null`, [input.tradingCardVariantId]
        )
        if (!variant || variant.trading_card_id !== input.tradingCardId) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "External reference variant does not belong to the trading card")
        }
      }
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_external_reference where provider = ? and provider_identifier = ?
         and deleted_at is null for update`, [input.provider, input.providerIdentifier]
      )
      const next = {
        trading_card_id: input.tradingCardId, trading_card_variant_id: input.tradingCardVariantId ?? null,
        provider: input.provider, provider_identifier: input.providerIdentifier, language: input.language ?? null,
        region: input.region ?? null, raw_payload_note: input.rawPayloadNote ?? null,
      }
      const id = (current?.id as string | undefined) ?? generateEntityId(undefined, "tcref")
      if (current) {
        await manager.execute(
          `update trading_card_external_reference set trading_card_id = ?, trading_card_variant_id = ?, language = ?,
           region = ?, raw_payload_note = ?, updated_at = now() where id = ?`,
          [next.trading_card_id, next.trading_card_variant_id, next.language, next.region, next.raw_payload_note, id]
        )
      } else {
        await manager.execute(
          `insert into trading_card_external_reference
           (id, trading_card_id, trading_card_variant_id, provider, provider_identifier, language, region, raw_payload_note)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, next.trading_card_id, next.trading_card_variant_id, next.provider, next.provider_identifier, next.language, next.region, next.raw_payload_note]
        )
      }
      await this.writeAudit(manager, {
        ...input, entityType: AUDIT_ENTITY_TYPE.EXTERNAL_CARD_REFERENCE, entityId: id,
        action: current ? AUDIT_ACTION.EXTERNAL_REFERENCE_CHANGED : AUDIT_ACTION.EXTERNAL_REFERENCE_ADDED,
        oldValue: current, newValue: next,
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_external_reference where id = ? and deleted_at is null`, [id]
      )
      return saved
    })
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
        action: AUDIT_ACTION.EXTERNAL_REFERENCE_REMOVED, oldValue: current,
      })
    })
  }
}

export default TradingCardsModuleService
