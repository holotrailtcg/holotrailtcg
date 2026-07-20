export function ebayCallbackResultMessage(result: string | null): string | null {
  if (!result) return null
  if (result === "connected") return "eBay connection completed."
  if (result === "denied") return "eBay authorisation was cancelled."
  if (result === "superseded") {
    return "That eBay connection attempt was superseded by a newer action. No current connection was changed."
  }
  return "eBay connection failed safely. You can try again."
}
