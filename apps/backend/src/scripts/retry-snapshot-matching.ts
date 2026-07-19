import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { retryPulseSnapshotMatchingWorkflow } from "../workflows/trading-card-inventory/retry-pulse-snapshot-matching"

/**
 * File-free operational retry for an existing inventory snapshot.
 *
 * Usage:
 *   $env:TCI_RETRY_SNAPSHOT_ID = "tcisnap_..."
 *   pnpm exec medusa exec ./src/scripts/retry-snapshot-matching.ts
 */
export default async function retrySnapshotMatching({ container }: { container: MedusaContainer }) {
  const snapshotId = process.env.TCI_RETRY_SNAPSHOT_ID?.trim()
  if (!snapshotId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_RETRY_SNAPSHOT_ID is required")

  const { result } = await retryPulseSnapshotMatchingWorkflow(container).run({
    input: {
      actor: "system:retry-snapshot-matching",
      source: "MANUAL",
      snapshotId,
      reason: "Repair and retry all outstanding snapshot-entry matches",
    },
  })

  console.log(JSON.stringify("snapshotId" in result
    ? { kind: result.kind, snapshotId: result.snapshotId, snapshotStatus: result.snapshotStatus }
    : { kind: result.kind }))
}
