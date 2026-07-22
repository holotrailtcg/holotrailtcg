import type { MedusaContainer } from "@medusajs/framework"
import { randomUUID } from "node:crypto"
import { EBAY_INTEGRATION_MODULE } from "../modules/ebay-integration"
import type EbayIntegrationModuleService from "../modules/ebay-integration/service"
import type { CategoryAssignmentRuleDto } from "../modules/ebay-integration/service"
import type { EbayEnvironment } from "../modules/ebay-integration/types"

/**
 * Second pass on the initial ruleset (`create-initial-category-assignment-rules.ts`):
 *
 * 1. Fixes a real bug found via `recompute-proposal-categories.ts`: Pulse's
 *    rarity mapper (`pulse/rarity-mapping.ts`) only ever produces a
 *    canonical `rarity_candidate` for common/uncommon/double rare/ultra
 *    rare/ace spec/promo/no rarity — every other rarity (Illustration Rare,
 *    Hyper Rare, Shiny Ultra Rare, Mega Hyper Rare, Ultra Rare Single,
 *    Black White Rare) is deliberately left as raw text forever. The
 *    original rules only matched the canonical enum spelling
 *    (`ILLUSTRATION_RARE`), so they silently never matched real data.
 *    Confirmed exact raw text via `recompute-proposal-categories.ts`
 *    against real Dottler/Snom rows: "Illustration Rare". The other raw
 *    forms (Hyper Rare, Shiny Ultra Rare, Mega Hyper Rare, Ultra Rare
 *    Single) follow the same Title Case convention but have NOT been
 *    confirmed against a real imported card of that rarity yet — added on
 *    that reasonable assumption, to be corrected once real data exists.
 * 2. Adds Scarlet & Violet set-level refinement for Illustration Rares &
 *    SIRs (the 4 SV sets that actually have an IR-specific eBay category:
 *    SV01, SV06, SV08, SV10.5 — SV04/SV05 already exist from pass one) and
 *    for Reverse Holos (all 15 SV sets have one). Set names are TCGdex's
 *    real official names (confirmed via api.tcgdex.net/v2/en/series/sv),
 *    which is what `cardSetDisplayName` is populated from at card-creation
 *    time — not guessed.
 *
 * Usage: pnpm exec medusa exec ./src/scripts/extend-category-assignment-rules.ts
 */
const ENVIRONMENT: EbayEnvironment = "SANDBOX"

const IR_SET_TARGETS: Array<{ setName: string; targetStoreCategoryId: string; priority: number }> = [
  { setName: "Scarlet & Violet", targetStoreCategoryId: "ebstorecat_01KY1ZR8AM5RZ9BVJWTTXE7932", priority: 32 },
  { setName: "Twilight Masquerade", targetStoreCategoryId: "ebstorecat_01KY1ZR8BJEHYA75PRPN0Z03J7", priority: 33 },
  { setName: "Surging Sparks", targetStoreCategoryId: "ebstorecat_01KY1ZR8BXVXTH3E5RSVM2GG9R", priority: 34 },
  { setName: "Black Bolt", targetStoreCategoryId: "ebstorecat_01KY1ZR8C76FNARES0MP43ANQP", priority: 35 },
]

const REVERSE_HOLO_SET_TARGETS: Array<{ setName: string; targetStoreCategoryId: string; priority: number }> = [
  { setName: "Scarlet & Violet", targetStoreCategoryId: "ebstorecat_01KY1ZR95AEXDV984EGTMP6GHQ", priority: 61 },
  { setName: "Paldea Evolved", targetStoreCategoryId: "ebstorecat_01KY1ZR95NHSWCFBSCH8QQYM8H", priority: 62 },
  { setName: "Obsidian Flames", targetStoreCategoryId: "ebstorecat_01KY1ZR95ZYAWX0ZVQ9RXSF0VS", priority: 63 },
  { setName: "Paradox Rift", targetStoreCategoryId: "ebstorecat_01KY1ZR969TTN7GEK6QNESG3P1", priority: 64 },
  { setName: "Temporal Forces", targetStoreCategoryId: "ebstorecat_01KY1ZR96M9PM4QMB7GQFY98GY", priority: 65 },
  { setName: "Twilight Masquerade", targetStoreCategoryId: "ebstorecat_01KY1ZR96YR0TG8BGM0ZDJFNEN", priority: 66 },
  { setName: "Stellar Crown", targetStoreCategoryId: "ebstorecat_01KY1ZR9793F9SXD8QMQM5BFSS", priority: 67 },
  { setName: "Surging Sparks", targetStoreCategoryId: "ebstorecat_01KY1ZR97KT8P5XV8QMF7A861A", priority: 68 },
  { setName: "Journey Together", targetStoreCategoryId: "ebstorecat_01KY1ZR97X9JFAEM80355JZSHN", priority: 69 },
  { setName: "Destined Rivals", targetStoreCategoryId: "ebstorecat_01KY1ZR9875PG2408YDGKP7DJT", priority: 70 },
  { setName: "Black Bolt", targetStoreCategoryId: "ebstorecat_01KY1ZR98HXVY9NK3E6D35JNMN", priority: 71 },
  { setName: "151", targetStoreCategoryId: "ebstorecat_01KY1ZR98V19T2DK1934J6DGEX", priority: 72 },
  { setName: "Paldean Fates", targetStoreCategoryId: "ebstorecat_01KY1ZR995B20JKKVEK8S0QJPJ", priority: 73 },
  { setName: "Shrouded Fable", targetStoreCategoryId: "ebstorecat_01KY1ZR99FZ277FGN96KJTNMEW", priority: 74 },
  { setName: "Prismatic Evolutions", targetStoreCategoryId: "ebstorecat_01KY1ZR99SG00NTB6TD0QMJ2B1", priority: 75 },
]

export default async function extendCategoryAssignmentRules({ container }: { container: MedusaContainer }) {
  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const existing = await ebayIntegration.listCategoryAssignmentRules(ENVIRONMENT)
  const byName = new Map(existing.map((rule) => [rule.name, rule]))

  const updated: CategoryAssignmentRuleDto[] = []
  const created: CategoryAssignmentRuleDto[] = []

  // Fix 1: add the real raw-text rarity forms alongside the canonical enum.
  const irParadoxRift = byName.get("Illustration Rare — Paradox Rift")
  const irTemporalForces = byName.get("Illustration Rare — Temporal Forces")
  const irOtherSets = byName.get("Illustration Rare — other sets")
  const ultraTier = byName.get("Ultra/Hyper/Shiny Ultra/Mega Hyper rare")
  if (!irParadoxRift || !irTemporalForces || !irOtherSets || !ultraTier) {
    throw new Error("Expected rules from create-initial-category-assignment-rules.ts were not found — run that script first.")
  }

  for (const rule of [irParadoxRift, irTemporalForces]) {
    const setCondition = rule.conditions.find((c) => c.field === "SET_NAME")!
    const saved = await ebayIntegration.updateCategoryAssignmentRule({
      environment: ENVIRONMENT, id: rule.id, name: rule.name, enabled: rule.enabled, priority: rule.priority,
      targetStoreCategoryId: rule.targetStoreCategoryId,
      conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE", "Illustration Rare"] }, setCondition],
      actorId: "system:extend-category-assignment-rules", correlationId: randomUUID(),
    })
    updated.push(saved)
  }
  {
    const saved = await ebayIntegration.updateCategoryAssignmentRule({
      environment: ENVIRONMENT, id: irOtherSets.id, name: irOtherSets.name, enabled: irOtherSets.enabled, priority: irOtherSets.priority,
      targetStoreCategoryId: irOtherSets.targetStoreCategoryId,
      conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE", "Illustration Rare"] }],
      actorId: "system:extend-category-assignment-rules", correlationId: randomUUID(),
    })
    updated.push(saved)
  }
  {
    const saved = await ebayIntegration.updateCategoryAssignmentRule({
      environment: ENVIRONMENT, id: ultraTier.id, name: ultraTier.name, enabled: ultraTier.enabled, priority: ultraTier.priority,
      targetStoreCategoryId: ultraTier.targetStoreCategoryId,
      conditions: [{
        field: "RARITY",
        values: [
          "ULTRA_RARE", "ULTRA_RARE_SINGLE", "HYPER_RARE", "SHINY_ULTRA_RARE", "MEGA_HYPER_RARE",
          "Ultra Rare", "Ultra Rare Single", "Hyper Rare", "Shiny Ultra Rare", "Mega Hyper Rare",
        ],
      }],
      actorId: "system:extend-category-assignment-rules", correlationId: randomUUID(),
    })
    updated.push(saved)
  }

  // Fix 2: bump the generic Reverse Holo rule below the new set-specific ones.
  const reverseHoloGeneric = byName.get("Reverse Holo finish")
  if (!reverseHoloGeneric) throw new Error("Expected rule 'Reverse Holo finish' was not found.")
  if (reverseHoloGeneric.priority < 90) {
    const saved = await ebayIntegration.updateCategoryAssignmentRule({
      environment: ENVIRONMENT, id: reverseHoloGeneric.id, name: reverseHoloGeneric.name, enabled: reverseHoloGeneric.enabled,
      priority: 90, targetStoreCategoryId: reverseHoloGeneric.targetStoreCategoryId, conditions: reverseHoloGeneric.conditions,
      actorId: "system:extend-category-assignment-rules", correlationId: randomUUID(),
    })
    updated.push(saved)
  }

  // New set-specific Illustration Rare rules.
  for (const target of IR_SET_TARGETS) {
    const name = `Illustration Rare — ${target.setName}`
    if (byName.has(name)) continue
    const saved = await ebayIntegration.createCategoryAssignmentRule({
      environment: ENVIRONMENT, name, enabled: true, priority: target.priority, targetStoreCategoryId: target.targetStoreCategoryId,
      conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE", "Illustration Rare"] }, { field: "SET_NAME", values: [target.setName] }],
      actorId: "system:extend-category-assignment-rules", correlationId: randomUUID(),
    })
    created.push(saved)
  }

  // New set-specific Reverse Holo rules.
  for (const target of REVERSE_HOLO_SET_TARGETS) {
    const name = `Reverse Holo — ${target.setName}`
    if (byName.has(name)) continue
    const saved = await ebayIntegration.createCategoryAssignmentRule({
      environment: ENVIRONMENT, name, enabled: true, priority: target.priority, targetStoreCategoryId: target.targetStoreCategoryId,
      conditions: [{ field: "FINISH", values: ["REVERSE_HOLO"] }, { field: "SET_NAME", values: [target.setName] }],
      actorId: "system:extend-category-assignment-rules", correlationId: randomUUID(),
    })
    created.push(saved)
  }

  console.log(JSON.stringify({ updatedCount: updated.length, createdCount: created.length, updated, created }, null, 2))
}
