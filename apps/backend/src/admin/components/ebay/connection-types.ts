export type EbayEnvironment = "SANDBOX" | "PRODUCTION"
export type EbayConnectionStatus = "CONNECTING" | "CONNECTED" | "DEGRADED" | "REFRESH_REQUIRED" | "DISCONNECTING" | "REVOKED" | "DISCONNECTED" | "ERROR"

export interface SafeEbayConnectionDto {
  id: string
  environment: EbayEnvironment
  ebayAccountId: string | null
  displayName: string | null
  status: EbayConnectionStatus
  grantedScopes: string[]
  connectedAt: string | null
  disconnectedAt: string | null
  lastRefreshAt: string | null
  lastSafeErrorCategory: string | null
}

export interface EbayEnvironmentStatusDto {
  environment: EbayEnvironment
  configured: boolean
  connection: SafeEbayConnectionDto | null
  reconnectRequired: boolean
}

export interface EbayConnectionStatusResponse {
  enabled: boolean
  environments: EbayEnvironmentStatusDto[]
}
