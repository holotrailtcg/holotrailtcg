import type { MedusaContainer } from "@medusajs/framework"
import { randomUUID } from "node:crypto"
import { EBAY_INTEGRATION_MODULE } from "../modules/ebay-integration"
import type EbayIntegrationModuleService from "../modules/ebay-integration/service"
import type { CategoryAssignmentRuleDto } from "../modules/ebay-integration/service"
import type { EbayEnvironment } from "../modules/ebay-integration/types"

/**
 * Initial, deliberately-conservative eBay Store category assignment
 * ruleset, built 2026-07-21 from the real 124-category SANDBOX tree and the
 * decisions already recorded for this stage (see
 * `docs/operations/stage-e2b-ebay-category-assignment.md` and this
 * session's memory): language wins over finish for JA/ZH cards, Trainer
 * Gallery and Pokémon V/VMAX/VSTAR both route together but the rule engine
 * has no field to detect either (or "ex") from card data alone, so those
 * three buckets are deliberately left unrouted — cards that would belong
 * there fall through to the configured fallback category and need manual
 * assignment until a real signal exists to rule on.
 *
 * Every targetStoreCategoryId below is a real ACTIVE SANDBOX category id
 * confirmed via `list-ebay-store-categories.ts`, not guessed.
 *
 * Usage: pnpm exec medusa exec ./src/scripts/create-initial-category-assignment-rules.ts
 */
const ENVIRONMENT: EbayEnvironment = "SANDBOX"

const RULES: Array<{
  name: string
  priority: number
  targetStoreCategoryId: string
  conditions: Array<{ field: "LANGUAGE" | "FINISH" | "RARITY" | "SPECIAL_TREATMENT" | "SET_CODE" | "SET_NAME"; values: string[] }>
}> = [
  { name: "Japanese cards", priority: 10, targetStoreCategoryId: "ebstorecat_01KY1ZR8CHC9H48XVQGX8K5TPC",
    conditions: [{ field: "LANGUAGE", values: ["JA"] }] },
  { name: "Chinese cards", priority: 20, targetStoreCategoryId: "ebstorecat_01KY1ZR86STYJMAXTCY67XKS8Y",
    conditions: [{ field: "LANGUAGE", values: ["ZH"] }] },

  // Set-specific Illustration Rare refinement — only for sets we've
  // actually confirmed exist as real CardSet rows so far. Add more as
  // real Pulse imports bring in further Scarlet & Violet sets.
  { name: "Illustration Rare — Paradox Rift", priority: 30, targetStoreCategoryId: "ebstorecat_01KY1ZR8AYN9DRHFF0CD4GSF3Z",
    conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE"] }, { field: "SET_NAME", values: ["Paradox Rift"] }] },
  { name: "Illustration Rare — Temporal Forces", priority: 31, targetStoreCategoryId: "ebstorecat_01KY1ZR8B86TVYG36RADBT3ZEX",
    conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE"] }, { field: "SET_NAME", values: ["Temporal Forces"] }] },
  // Generic Illustration Rare catch-all for every other set.
  { name: "Illustration Rare — other sets", priority: 40, targetStoreCategoryId: "ebstorecat_01KY1ZR88PK6WKDMW0GVFF0BX1",
    conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE"] }] },

  // "Ultra rare tier" rarities. Deliberately excludes DOUBLE_RARE (the
  // typical rarity for a regular, non-full-art ex card in modern sets) —
  // that's exactly the ex-card ambiguity we agreed not to guess at.
  { name: "Ultra/Hyper/Shiny Ultra/Mega Hyper rare", priority: 50, targetStoreCategoryId: "ebstorecat_01KY1ZR9DV7XKBACK0M6KK78F4",
    conditions: [{ field: "RARITY", values: ["ULTRA_RARE", "ULTRA_RARE_SINGLE", "HYPER_RARE", "SHINY_ULTRA_RARE", "MEGA_HYPER_RARE"] }] },

  { name: "Promo cards", priority: 60, targetStoreCategoryId: "ebstorecat_01KY1ZR84H4A6XACERDTGS9FF4",
    conditions: [{ field: "RARITY", values: ["PROMO"] }] },

  // Finish-based, only reached once nothing rarity-specific matched above.
  { name: "Reverse Holo finish", priority: 70, targetStoreCategoryId: "ebstorecat_01KY1YBD7NFX1WE77GJ5SSW96J",
    conditions: [{ field: "FINISH", values: ["REVERSE_HOLO"] }] },

  { name: "Cosmos Holo special treatment", priority: 80, targetStoreCategoryId: "ebstorecat_01KY1ZR9AQDKDNSX0D5KCQZB8K",
    conditions: [{ field: "SPECIAL_TREATMENT", values: ["COSMOS_HOLO"] }] },
]

export default async function createInitialCategoryAssignmentRules({ container }: { container: MedusaContainer }) {
  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const existing = await ebayIntegration.listCategoryAssignmentRules(ENVIRONMENT)
  if (existing.length > 0) {
    console.log(JSON.stringify({ skipped: true, reason: `${existing.length} rule(s) already exist for ${ENVIRONMENT} — refusing to create duplicates.`, existing }))
    return
  }

  const created: CategoryAssignmentRuleDto[] = []
  for (const rule of RULES) {
    const saved = await ebayIntegration.createCategoryAssignmentRule({
      environment: ENVIRONMENT,
      name: rule.name,
      enabled: true,
      priority: rule.priority,
      targetStoreCategoryId: rule.targetStoreCategoryId,
      conditions: rule.conditions,
      actorId: "system:create-initial-category-assignment-rules",
      correlationId: randomUUID(),
    })
    created.push(saved)
  }
  console.log(JSON.stringify({ createdCount: created.length, created }, null, 2))
}
