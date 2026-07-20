import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import { EBAY_ENVIRONMENT, type EbayEnvironment } from "./types"

const configSchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  clientSecret: z.string().trim().min(1).max(512),
  redirectUri: z.string().trim().min(1).max(255),
}).strict()

export interface EbayEnvironmentConfig {
  environment: EbayEnvironment
  clientId: string
  clientSecret: string
  redirectUri: string
  authorisationUrl: string
  tokenUrl: string
  revokeUrl: string
  identityUrl: string
}

const PREFIX: Record<EbayEnvironment, string> = {
  SANDBOX: "EBAY_SANDBOX",
  PRODUCTION: "EBAY_PRODUCTION",
}

const ENDPOINTS: Record<EbayEnvironment, Pick<EbayEnvironmentConfig, "authorisationUrl" | "tokenUrl" | "revokeUrl" | "identityUrl">> = {
  SANDBOX: {
    authorisationUrl: "https://auth.sandbox.ebay.com/oauth2/authorize",
    tokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    revokeUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token/revoke",
    identityUrl: "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/",
  },
  PRODUCTION: {
    authorisationUrl: "https://auth.ebay.com/oauth2/authorize",
    tokenUrl: "https://api.ebay.com/identity/v1/oauth2/token",
    revokeUrl: "https://api.ebay.com/identity/v1/oauth2/token/revoke",
    identityUrl: "https://apiz.ebay.com/commerce/identity/v1/user/",
  },
}

export function ebayConnectionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EBAY_CONNECTIONS_ENABLED === "true"
}

export function isEbayEnvironment(value: string): value is EbayEnvironment {
  return value === EBAY_ENVIRONMENT.SANDBOX || value === EBAY_ENVIRONMENT.PRODUCTION
}

export function hasEbayEnvironmentConfig(environment: EbayEnvironment, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    resolveEbayEnvironmentConfig(environment, env)
    return true
  } catch {
    return false
  }
}

export function resolveEbayEnvironmentConfig(
  environment: EbayEnvironment,
  env: NodeJS.ProcessEnv = process.env
): EbayEnvironmentConfig {
  if (!ebayConnectionsEnabled(env)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "eBay connections are not enabled.")
  }
  const prefix = PREFIX[environment]
  const result = configSchema.safeParse({
    clientId: env[`${prefix}_CLIENT_ID`],
    clientSecret: env[`${prefix}_CLIENT_SECRET`],
    redirectUri: env[`${prefix}_REDIRECT_URI`],
  })
  if (!result.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `The ${environment.toLowerCase()} eBay connection is not configured.`)
  }
  return { environment, ...result.data, ...ENDPOINTS[environment] }
}
