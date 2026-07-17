import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { retryPulseSnapshotMatching } from "./pulse-import-shared"
import type { RetryPulseSnapshotMatchingInput } from "./retry-pulse-snapshot-matching-types"

export { retryPulseSnapshotMatching }

const retryPulseSnapshotMatchingStep = createStep(
  "retry-pulse-snapshot-matching",
  async (input: RetryPulseSnapshotMatchingInput, { container }) =>
    new StepResponse(await retryPulseSnapshotMatching(container, input)),
)

export const retryPulseSnapshotMatchingWorkflow = createWorkflow(
  "retry-pulse-snapshot-matching",
  (input: RetryPulseSnapshotMatchingInput) => new WorkflowResponse(retryPulseSnapshotMatchingStep(input)),
)
