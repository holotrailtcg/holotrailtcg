import { evaluateCategoryAssignment, type CategoryAssignmentRule } from "../evaluate"

const rule = (overrides: Partial<CategoryAssignmentRule>): CategoryAssignmentRule => ({
  id: overrides.id ?? "rule-1",
  name: overrides.name ?? "Rule",
  enabled: overrides.enabled ?? true,
  priority: overrides.priority ?? 100,
  targetStoreCategoryId: overrides.targetStoreCategoryId ?? "cat-1",
  conditions: overrides.conditions ?? [],
})

describe("evaluateCategoryAssignment", () => {
  it("returns the first matching enabled rule in ascending priority order", () => {
    const rules: CategoryAssignmentRule[] = [
      rule({ id: "low-priority", priority: 200, targetStoreCategoryId: "cat-b", conditions: [{ field: "FINISH", values: ["HOLO"] }] }),
      rule({ id: "high-priority", priority: 10, targetStoreCategoryId: "cat-a", conditions: [{ field: "FINISH", values: ["HOLO"] }] }),
    ]
    const active = new Set(["cat-a", "cat-b"])
    const result = evaluateCategoryAssignment(rules, null, active, { finish: "HOLO" })
    expect(result.outcome).toBe("RULE_MATCH")
    expect(result.storeCategoryId).toBe("cat-a")
    expect(result.matchedRuleId).toBe("high-priority")
  })

  it("skips disabled rules", () => {
    const rules: CategoryAssignmentRule[] = [
      rule({ id: "disabled", enabled: false, priority: 1, conditions: [{ field: "FINISH", values: ["HOLO"] }] }),
    ]
    const result = evaluateCategoryAssignment(rules, null, new Set(["cat-1"]), { finish: "HOLO" })
    expect(result.outcome).toBe("NO_MATCH")
  })

  it("skips a rule whose target category is not active", () => {
    const rules: CategoryAssignmentRule[] = [
      rule({ priority: 1, targetStoreCategoryId: "cat-removed", conditions: [{ field: "FINISH", values: ["HOLO"] }] }),
    ]
    const result = evaluateCategoryAssignment(rules, null, new Set(["cat-other"]), { finish: "HOLO" })
    expect(result.outcome).toBe("NO_MATCH")
  })

  it("requires every condition on a rule to match (AND)", () => {
    const rules: CategoryAssignmentRule[] = [
      rule({
        priority: 1,
        conditions: [
          { field: "FINISH", values: ["HOLO"] },
          { field: "LANGUAGE", values: ["JA"] },
        ],
      }),
    ]
    const active = new Set(["cat-1"])
    expect(evaluateCategoryAssignment(rules, null, active, { finish: "HOLO", language: "EN" }).outcome).toBe("NO_MATCH")
    expect(evaluateCategoryAssignment(rules, null, active, { finish: "HOLO", language: "JA" }).outcome).toBe("RULE_MATCH")
  })

  it("matches case-insensitively and trims whitespace", () => {
    const rules: CategoryAssignmentRule[] = [rule({ priority: 1, conditions: [{ field: "RARITY", values: [" Illustration Rare "] }] })]
    const result = evaluateCategoryAssignment(rules, null, new Set(["cat-1"]), { rarity: "illustration rare" })
    expect(result.outcome).toBe("RULE_MATCH")
  })

  it("matches Pulse's raw-text rarity when the rule's condition also lists the canonical enum form (per the E2B raw/canonical gotcha)", () => {
    // `pulse/rarity-mapping.ts` only produces a canonical enum for a limited
    // set of rarities — Illustration Rare stays as Pulse's raw text forever.
    // Rules must list both forms as separate condition values; only the raw
    // text form is what real Pulse input actually carries.
    const rules: CategoryAssignmentRule[] = [
      rule({ priority: 1, conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE", "Illustration Rare"] }] }),
    ]
    const active = new Set(["cat-1"])

    const result = evaluateCategoryAssignment(rules, null, active, { rarity: "Illustration Rare" })
    expect(result.outcome).toBe("RULE_MATCH")
    expect(result.storeCategoryId).toBe("cat-1")
  })

  it("does not match on the canonical enum value alone when the incoming attribute is only ever the raw Pulse text", () => {
    const rules: CategoryAssignmentRule[] = [
      rule({ priority: 1, conditions: [{ field: "RARITY", values: ["ILLUSTRATION_RARE"] }] }),
    ]
    const result = evaluateCategoryAssignment(rules, null, new Set(["cat-1"]), { rarity: "Illustration Rare" })
    expect(result.outcome).toBe("NO_MATCH")
  })

  it("never matches a rule with zero conditions", () => {
    const rules: CategoryAssignmentRule[] = [rule({ priority: 1, conditions: [] })]
    const result = evaluateCategoryAssignment(rules, null, new Set(["cat-1"]), { finish: "HOLO" })
    expect(result.outcome).toBe("NO_MATCH")
  })

  it("falls back to the configured fallback category when no rule matches", () => {
    const rules: CategoryAssignmentRule[] = [rule({ priority: 1, conditions: [{ field: "FINISH", values: ["HOLO"] }] })]
    const result = evaluateCategoryAssignment(rules, "fallback-cat", new Set(["cat-1", "fallback-cat"]), { finish: "NON_HOLO" })
    expect(result.outcome).toBe("FALLBACK")
    expect(result.storeCategoryId).toBe("fallback-cat")
  })

  it("returns no proposal when the fallback category is configured but no longer active", () => {
    const result = evaluateCategoryAssignment([], "fallback-cat", new Set(["other-cat"]), {})
    expect(result.outcome).toBe("NO_MATCH")
    expect(result.storeCategoryId).toBeNull()
  })

  it("returns no proposal when nothing matches and no fallback is configured", () => {
    const result = evaluateCategoryAssignment([], null, new Set(), {})
    expect(result.outcome).toBe("NO_MATCH")
    expect(result.storeCategoryId).toBeNull()
    expect(result.reason).toContain("no fallback")
  })

  it("never matches a condition against a missing attribute", () => {
    const rules: CategoryAssignmentRule[] = [rule({ priority: 1, conditions: [{ field: "SET_CODE", values: ["SV1"] }] })]
    const result = evaluateCategoryAssignment(rules, null, new Set(["cat-1"]), { setCode: null })
    expect(result.outcome).toBe("NO_MATCH")
  })
})
