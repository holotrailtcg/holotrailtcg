import type { CategoryAssignmentConditionField } from "../types"

/**
 * Card-level attributes available at proposal time, sourced from the Pulse
 * import row / inventory source. All optional: an absent value simply never
 * satisfies a condition that tests it (see `matchesCondition`).
 */
export interface CategoryAssignmentCardAttributes {
  language?: string | null
  finish?: string | null
  rarity?: string | null
  specialTreatment?: string | null
  setCode?: string | null
  setName?: string | null
}

export interface CategoryAssignmentCondition {
  field: CategoryAssignmentConditionField
  values: string[]
}

export interface CategoryAssignmentRule {
  id: string
  name: string
  enabled: boolean
  priority: number
  targetStoreCategoryId: string
  conditions: CategoryAssignmentCondition[]
}

export type CategoryAssignmentOutcome = "RULE_MATCH" | "FALLBACK" | "NO_MATCH"

export interface CategoryAssignmentResult {
  storeCategoryId: string | null
  reason: string
  matchedRuleId: string | null
  matchedRuleName: string | null
  outcome: CategoryAssignmentOutcome
}

function attributeFor(field: CategoryAssignmentConditionField, attributes: CategoryAssignmentCardAttributes): string | null | undefined {
  switch (field) {
    case "LANGUAGE": return attributes.language
    case "FINISH": return attributes.finish
    case "RARITY": return attributes.rarity
    case "SPECIAL_TREATMENT": return attributes.specialTreatment
    case "SET_CODE": return attributes.setCode
    case "SET_NAME": return attributes.setName
    default: return undefined
  }
}

function matchesCondition(condition: CategoryAssignmentCondition, attributes: CategoryAssignmentCardAttributes): boolean {
  const raw = attributeFor(condition.field, attributes)
  if (raw === null || raw === undefined || raw === "") return false
  const normalised = String(raw).trim().toLowerCase()
  return condition.values.some((value) => value.trim().toLowerCase() === normalised)
}

/** A rule with no conditions can never match — see the module doc comment on the rule model. */
function matchesRule(rule: CategoryAssignmentRule, attributes: CategoryAssignmentCardAttributes): boolean {
  if (rule.conditions.length === 0) return false
  return rule.conditions.every((condition) => matchesCondition(condition, attributes))
}

/**
 * Evaluates enabled rules in ascending `priority` order (lowest number
 * first). The first matching rule whose target category is still ACTIVE
 * wins. Rules targeting a REMOVED category are skipped entirely (never
 * silently "reactivate" a removed category by proposing it). Falls back to
 * the configured fallback category if it is still ACTIVE; otherwise returns
 * no proposal at all, requiring a manual Admin choice.
 */
export function evaluateCategoryAssignment(
  rules: CategoryAssignmentRule[],
  fallbackStoreCategoryId: string | null,
  activeStoreCategoryIds: ReadonlySet<string>,
  attributes: CategoryAssignmentCardAttributes,
): CategoryAssignmentResult {
  const candidates = rules.filter((rule) => rule.enabled).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  for (const rule of candidates) {
    if (!activeStoreCategoryIds.has(rule.targetStoreCategoryId)) continue
    if (matchesRule(rule, attributes)) {
      return {
        storeCategoryId: rule.targetStoreCategoryId,
        reason: `Matched rule "${rule.name}"`,
        matchedRuleId: rule.id,
        matchedRuleName: rule.name,
        outcome: "RULE_MATCH",
      }
    }
  }
  if (fallbackStoreCategoryId && activeStoreCategoryIds.has(fallbackStoreCategoryId)) {
    return {
      storeCategoryId: fallbackStoreCategoryId,
      reason: "No rule matched — fallback category applied",
      matchedRuleId: null,
      matchedRuleName: null,
      outcome: "FALLBACK",
    }
  }
  return {
    storeCategoryId: null,
    reason: fallbackStoreCategoryId
      ? "No rule matched and the configured fallback category is no longer active"
      : "No rule matched and no fallback category is configured",
    matchedRuleId: null,
    matchedRuleName: null,
    outcome: "NO_MATCH",
  }
}
