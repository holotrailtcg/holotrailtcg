import type { MedusaRequest } from "@medusajs/framework/http"
import {
  extractClientAddress,
  resolveTrustedProxyConfig,
  type ClientAddressResult,
} from "../../../../modules/newsletter/rate-limit/client-address"

/**
 * Resolves the trusted client address for a request using the existing,
 * unmodified Stage 2C.4 trust model (`rate-limit/client-address.ts`): by
 * default only the direct socket remote address is trusted; a single named
 * header is only trusted when both `NEWSLETTER_TRUST_PROXY` and
 * `NEWSLETTER_TRUSTED_IP_HEADER` are explicitly configured. No route-level
 * override of this trust model exists — arbitrary `X-Forwarded-For` values
 * are never trusted directly.
 */
export function resolveRequestClientAddress(req: MedusaRequest): ClientAddressResult {
  const proxyConfig = resolveTrustedProxyConfig()

  return extractClientAddress(
    {
      socketRemoteAddress: req.socket?.remoteAddress ?? null,
      headers: req.headers as Record<string, string | string[] | undefined>,
    },
    proxyConfig
  )
}
