import type { MedusaContainer } from "@medusajs/framework/types"
import {
  exchangeAuthorisationCode, getEbayIdentity, refreshUserAccessToken, revokeRefreshToken,
} from "./oauth/client"

export const EBAY_OAUTH_CLIENT_KEY = "ebayOAuthClient"

export interface EbayOAuthClient {
  exchangeAuthorisationCode: typeof exchangeAuthorisationCode
  getIdentity: typeof getEbayIdentity
  refreshUserAccessToken: typeof refreshUserAccessToken
  revokeRefreshToken: typeof revokeRefreshToken
}

const defaultClient: EbayOAuthClient = {
  exchangeAuthorisationCode,
  getIdentity: getEbayIdentity,
  refreshUserAccessToken,
  revokeRefreshToken,
}

export function resolveEbayOAuthClient(container: MedusaContainer): EbayOAuthClient {
  try {
    return container.resolve<EbayOAuthClient>(EBAY_OAUTH_CLIENT_KEY)
  } catch {
    return defaultClient
  }
}
