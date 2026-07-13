import { isIP } from "node:net"
import { MedusaError } from "@medusajs/framework/utils"
import type { EnvSource } from "../shared/env-parsing"

/**
 * Client-address trust model (see docs/decisions/0005 for the full
 * write-up). The Medusa production host is not yet finalised, so this
 * deliberately does not implement a generic proxy-trust framework or trust
 * `X-Forwarded-For` by default:
 *
 * - By default, only the direct socket/framework-provided remote address
 *   is trusted (`context.socketRemoteAddress`).
 * - A single named header may be trusted instead, but only when both
 *   `NEWSLETTER_TRUST_PROXY=true` and `NEWSLETTER_TRUSTED_IP_HEADER` are
 *   explicitly set — this is a deployment-time decision the final Medusa
 *   host owner must make, not a default.
 * - When header trust is enabled, the header must carry exactly one
 *   address: a repeated header or a comma-separated forwarding chain (the
 *   classic multi-hop `X-Forwarded-For` shape) is rejected outright, since
 *   there is no configured trust boundary for "which hop counts" yet.
 * - Whichever source is configured, the resulting candidate must parse as
 *   a syntactically valid IPv4 or IPv6 address (via Node's built-in
 *   `net.isIP`) or the whole lookup fails closed.
 */
export interface ClientAddressContext {
  /** e.g. `req.socket.remoteAddress` — the framework's own direct peer address. */
  socketRemoteAddress?: string | null
  /** Raw incoming headers, keyed by lower-case header name. */
  headers: Record<string, string | string[] | undefined>
}

export interface TrustedProxyConfig {
  trustProxy: boolean
  trustedHeaderName?: string
}

export type ClientAddressFailureReason =
  | "NO_ADDRESS"
  | "MALFORMED_ADDRESS"
  | "MULTI_VALUE_HEADER"

export type ClientAddressResult =
  | { ok: true; address: string }
  | { ok: false; reason: ClientAddressFailureReason }

/**
 * Reads the narrow proxy-trust configuration. Throws if `NEWSLETTER_TRUST_PROXY`
 * is enabled without naming a header — an enabled-but-unconfigured trust
 * mode is a misconfiguration, not a silent no-op.
 */
export function resolveTrustedProxyConfig(
  env: EnvSource = process.env
): TrustedProxyConfig {
  const trustProxy = (env.NEWSLETTER_TRUST_PROXY ?? "").trim().toLowerCase() === "true"
  const trustedHeaderName = env.NEWSLETTER_TRUSTED_IP_HEADER?.trim().toLowerCase() || undefined

  if (trustProxy && !trustedHeaderName) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "NEWSLETTER_TRUST_PROXY=true requires NEWSLETTER_TRUSTED_IP_HEADER to be set"
    )
  }

  return { trustProxy, trustedHeaderName }
}

export function extractClientAddress(
  context: ClientAddressContext,
  proxyConfig: TrustedProxyConfig
): ClientAddressResult {
  if (proxyConfig.trustProxy && proxyConfig.trustedHeaderName) {
    const headerValue = context.headers[proxyConfig.trustedHeaderName]

    if (headerValue === undefined) {
      return { ok: false, reason: "NO_ADDRESS" }
    }
    if (Array.isArray(headerValue)) {
      // A repeated header has no defined precedence in this design.
      return { ok: false, reason: "MULTI_VALUE_HEADER" }
    }
    if (headerValue.includes(",")) {
      // A comma-separated forwarding chain (classic X-Forwarded-For shape)
      // is never trusted here — no multi-hop trust boundary is configured.
      return { ok: false, reason: "MULTI_VALUE_HEADER" }
    }

    return normaliseCandidate(headerValue)
  }

  if (!context.socketRemoteAddress) {
    return { ok: false, reason: "NO_ADDRESS" }
  }

  return normaliseCandidate(context.socketRemoteAddress)
}

function normaliseCandidate(raw: string): ClientAddressResult {
  let candidate = raw.trim()

  if (candidate.length === 0) {
    return { ok: false, reason: "NO_ADDRESS" }
  }

  // Strip a bracketed IPv6 literal, e.g. "[::1]:12345" -> "::1".
  if (candidate.startsWith("[")) {
    const closing = candidate.indexOf("]")
    if (closing === -1) {
      return { ok: false, reason: "MALFORMED_ADDRESS" }
    }
    candidate = candidate.slice(1, closing)
  }

  // Strip an IPv6 zone id, e.g. "fe80::1%eth0" -> "fe80::1".
  candidate = candidate.split("%")[0]

  // Canonicalise an IPv4-mapped IPv6 address down to plain IPv4.
  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const mapped = candidate.slice("::ffff:".length)
    if (isIP(mapped) === 4) {
      candidate = mapped
    }
  }

  const version = isIP(candidate)
  if (version === 4) {
    return { ok: true, address: candidate }
  }
  if (version === 6) {
    return { ok: true, address: candidate.toLowerCase() }
  }

  return { ok: false, reason: "MALFORMED_ADDRESS" }
}
