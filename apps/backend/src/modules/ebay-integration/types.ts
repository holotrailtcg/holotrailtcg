export const EBAY_ENVIRONMENT = {
  SANDBOX: "SANDBOX",
  PRODUCTION: "PRODUCTION",
} as const
export type EbayEnvironment = (typeof EBAY_ENVIRONMENT)[keyof typeof EBAY_ENVIRONMENT]

export const EBAY_CONNECTION_STATUS = {
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  DEGRADED: "DEGRADED",
  REFRESH_REQUIRED: "REFRESH_REQUIRED",
  DISCONNECTING: "DISCONNECTING",
  REVOKED: "REVOKED",
  DISCONNECTED: "DISCONNECTED",
  ERROR: "ERROR",
} as const

export const EBAY_STORE_CATEGORY_STATUS = { ACTIVE: "ACTIVE", REMOVED: "REMOVED" } as const
export const EBAY_STORE_CATEGORY_SOURCE = { MANUAL: "MANUAL", CSV: "CSV" } as const
export type EbayConnectionStatus = (typeof EBAY_CONNECTION_STATUS)[keyof typeof EBAY_CONNECTION_STATUS]

export const EBAY_SAFE_ERROR = {
  CONFIGURATION_MISSING: "CONFIGURATION_MISSING",
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
  ALREADY_CONNECTED: "ALREADY_CONNECTED",
  INVALID_STATE: "INVALID_STATE",
  EXPIRED_STATE: "EXPIRED_STATE",
  CONSUMED_STATE: "CONSUMED_STATE",
  SUPERSEDED_ATTEMPT: "SUPERSEDED_ATTEMPT",
  STATE_ENVIRONMENT_MISMATCH: "STATE_ENVIRONMENT_MISMATCH",
  STATE_ACTOR_MISMATCH: "STATE_ACTOR_MISMATCH",
  USER_DENIED: "USER_DENIED",
  OAUTH_REJECTED: "OAUTH_REJECTED",
  IDENTITY_REJECTED: "IDENTITY_REJECTED",
  REMOTE_TIMEOUT: "REMOTE_TIMEOUT",
  REMOTE_UNAVAILABLE: "REMOTE_UNAVAILABLE",
  INVALID_REMOTE_RESPONSE: "INVALID_REMOTE_RESPONSE",
  TOKEN_DECRYPTION_FAILED: "TOKEN_DECRYPTION_FAILED",
  REFRESH_REQUIRED: "REFRESH_REQUIRED",
  REVOCATION_UNCONFIRMED: "REVOCATION_UNCONFIRMED",
  LIFECYCLE_LOCK_FAILED: "LIFECYCLE_LOCK_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const
export type EbaySafeErrorCategory = (typeof EBAY_SAFE_ERROR)[keyof typeof EBAY_SAFE_ERROR]

export const EBAY_AUDIT_ACTION = {
  CONNECTION_STARTED: "CONNECTION_STARTED",
  CONNECTION_COMPLETED: "CONNECTION_COMPLETED",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  TOKEN_REFRESHED: "TOKEN_REFRESHED",
  TOKEN_REFRESH_FAILED: "TOKEN_REFRESH_FAILED",
  LIFECYCLE_LOCK_FAILED: "LIFECYCLE_LOCK_FAILED",
  DISCONNECTED: "DISCONNECTED",
} as const

export const EBAY_OAUTH_STATE_TTL_MINUTES = 10
export const EBAY_OAUTH_STATE_RETENTION_HOURS = 24
export const EBAY_OAUTH_STATE_CLEANUP_LIMIT = 100
export const EBAY_OAUTH_TIMEOUT_MS = 10_000
export const EBAY_MAX_REMOTE_RESPONSE_BYTES = 64 * 1024
export const EBAY_ACCESS_TOKEN_SAFETY_MARGIN_MS = 60_000
export const EBAY_REFRESH_OPERATION_STALE_SECONDS = 60

// E1 asks only who authorised the connection. Later stages must add their
// scopes deliberately and require renewed consent; E1 never asks for selling
// or listing permissions speculatively.
export const EBAY_E1_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
] as const

// OAuth permits the token response to omit `scope` when it is unchanged from
// the consent request, and eBay's documented User token response does so. In
// that case the granted scopes are the exact E1 scopes we requested.
export function resolveEbayGrantedScopes(scope: string | undefined): string[] {
  return scope === undefined
    ? [...EBAY_E1_SCOPES]
    : scope.split(/\s+/).filter(Boolean)
}
