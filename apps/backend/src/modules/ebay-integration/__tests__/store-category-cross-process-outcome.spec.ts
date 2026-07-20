import { MedusaError } from "@medusajs/framework/utils"
import {
  classifyWorkerError,
  STALE_MUTATION_TARGET,
} from "./store-category-cross-process-outcome"

const runId = "12345678-1234-1234-1234-123456789abc"
const scenarioBMutateContext = {
  scenario: "MUTATION_VS_IMPORT",
  role: "MUTATE",
  runId,
  mutationTargetExternalId: `e2a1-${runId}-child-a`,
}

describe("E2A1 cross-process worker outcome classification", () => {
  it("classifies only the exact Scenario B run-owned stale target as validation rejected", () => {
    const error = new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Active Store category not found.",
    )

    expect(classifyWorkerError(error, scenarioBMutateContext)).toEqual({
      outcome: "VALIDATION_REJECTED",
      safeFailureCategory: STALE_MUTATION_TARGET,
    })
  })

  it.each([
    [
      "an unrelated NOT_FOUND message",
      new MedusaError(MedusaError.Types.NOT_FOUND, "Other record not found."),
      scenarioBMutateContext,
    ],
    [
      "the same NOT_FOUND outside the MUTATE role",
      new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Active Store category not found.",
      ),
      { ...scenarioBMutateContext, role: "IMPORT" },
    ],
    [
      "the same NOT_FOUND for a non-run-owned target",
      new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Active Store category not found.",
      ),
      {
        ...scenarioBMutateContext,
        mutationTargetExternalId: "existing-category",
      },
    ],
    [
      "the same NOT_FOUND with a different Medusa code",
      new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Active Store category not found.",
        "OTHER_NOT_FOUND",
      ),
      scenarioBMutateContext,
    ],
    ["a non-Medusa error", new Error("failure"), scenarioBMutateContext],
  ])("keeps %s as an unexpected failure", (_label, error, context) => {
    expect(classifyWorkerError(error, context)).toEqual({
      outcome: "UNEXPECTED_FAILURE",
    })
  })
})
