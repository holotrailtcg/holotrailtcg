import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { EBAY_INTEGRATION_MODULE } from "./index"
import type EbayIntegrationModuleService from "./service"
import type { EbayEnvironment } from "./types"

export function ebayLifecycleLockKey(environment: EbayEnvironment): string {
  return `ebay-lifecycle:${environment}`
}

function isLockAcquisitionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ""
  return message.includes("Timed-out acquiring lock") || message.includes("Failed to acquire lock")
}

export async function withEbayLifecycleLock<T>(input: {
  container: MedusaContainer
  environment: EbayEnvironment
  correlationId: string
  actorId?: string | null
  work: () => Promise<T>
}): Promise<T> {
  const locking = input.container.resolve<ILockingModule>(Modules.LOCKING)
  try {
    return await locking.execute(ebayLifecycleLockKey(input.environment), input.work)
  } catch (error) {
    if (!isLockAcquisitionFailure(error)) throw error
    const service = input.container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
    await service.recordLifecycleLockFailure({
      environment: input.environment, actorId: input.actorId, correlationId: input.correlationId,
    }).catch(() => undefined)
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `The eBay connection is busy (reference ${input.correlationId}).`
    )
  }
}
