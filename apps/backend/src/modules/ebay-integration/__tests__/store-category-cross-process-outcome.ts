import { MedusaError } from "@medusajs/framework/utils"

export const STALE_MUTATION_TARGET = "STALE_MUTATION_TARGET"

type WorkerErrorContext = {
  scenario: string
  role: string
  runId: string
  mutationTargetExternalId?: string
}

export type WorkerErrorClassification =
  | {
      outcome: "VALIDATION_REJECTED"
      safeFailureCategory?: typeof STALE_MUTATION_TARGET
    }
  | { outcome: "UNEXPECTED_FAILURE" }

function isExpectedValidation(error: unknown): boolean {
  if (
    !(error instanceof MedusaError) ||
    error.type !== MedusaError.Types.INVALID_DATA
  )
    return false
  return [
    "The import preview is no longer valid. Preview again.",
    "The catalogue changed after preview. Preview again.",
    "Scenario B fixture is unavailable.",
  ].includes(error.message)
}

function isScenarioBRunOwnedStaleTarget(
  error: unknown,
  context: WorkerErrorContext,
): boolean {
  const expectedTargetExternalId = `e2a1-${context.runId}-child-a`
  return (
    context.scenario === "MUTATION_VS_IMPORT" &&
    context.role === "MUTATE" &&
    /^[a-f0-9-]{36}$/.test(context.runId) &&
    context.mutationTargetExternalId === expectedTargetExternalId &&
    error instanceof MedusaError &&
    error.type === MedusaError.Types.NOT_FOUND &&
    error.code === undefined &&
    error.message === "Active Store category not found."
  )
}

export function classifyWorkerError(
  error: unknown,
  context: WorkerErrorContext,
): WorkerErrorClassification {
  if (isScenarioBRunOwnedStaleTarget(error, context)) {
    return {
      outcome: "VALIDATION_REJECTED",
      safeFailureCategory: STALE_MUTATION_TARGET,
    }
  }
  if (isExpectedValidation(error)) return { outcome: "VALIDATION_REJECTED" }
  return { outcome: "UNEXPECTED_FAILURE" }
}
