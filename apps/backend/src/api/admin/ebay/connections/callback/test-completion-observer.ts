import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const observedCompletionUrls: string[] = []

export function resetEbayCallbackCompletionUrls(): void {
  observedCompletionUrls.length = 0
}

export function getEbayCallbackCompletionUrls(): readonly string[] {
  return observedCompletionUrls
}

/** Test-only equivalent of Morgan's earlier middleware / completion read. */
export function observeEbayCallbackUrlAtCompletion(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  res.once("finish", () => observedCompletionUrls.push(req.originalUrl))
  next()
}
