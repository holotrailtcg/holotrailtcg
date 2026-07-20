import { randomUUID } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveEbayEnvironmentConfig } from "../../../../../../modules/ebay-integration/config"
import { encryptRefreshToken, resolveTokenEncryptionKeyring } from "../../../../../../modules/ebay-integration/crypto/token-encryption"
import { resolveEbayOAuthClient } from "../../../../../../modules/ebay-integration/dependencies"
import { withEbayLifecycleLock } from "../../../../../../modules/ebay-integration/lifecycle-lock"
import { hashOAuthState } from "../../../../../../modules/ebay-integration/oauth/state"
import { invalidateEbayAccessTokensForEnvironment } from "../../../../../../modules/ebay-integration/token-service"
import {
  EBAY_SAFE_ERROR, resolveEbayGrantedScopes,
  type EbayEnvironment, type EbaySafeErrorCategory,
} from "../../../../../../modules/ebay-integration/types"
import {
  callbackParamsSchema, callbackQuerySchema, callbackResultUrl,
  ebayIntegrationService, parseAdminInput, safeRemoteCategory,
} from "../../shared"

// This exact OAuth return endpoint is authenticated by the unguessable,
// single-use, hashed-at-rest state. Every other /admin/ebay route remains authenticated.
export const AUTHENTICATE = false

function redirect(res: MedusaResponse, environment: EbayEnvironment, result: "connected" | "denied" | "failed" | "superseded") {
  res.redirect(303, callbackResultUrl(environment, result))
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  let environment: EbayEnvironment
  try {
    environment = parseAdminInput(callbackParamsSchema, req.params).environment
  } catch {
    res.redirect(303, "/app/settings/ebay?result=failed")
    return
  }
  let query: ReturnType<typeof callbackQuerySchema.parse>
  try {
    query = parseAdminInput(callbackQuerySchema, req.query)
  } catch {
    redirect(res, environment, "failed")
    return
  }

  const correlationId = randomUUID()
  const service = ebayIntegrationService(req)
  let attempt
  try {
    attempt = await withEbayLifecycleLock({
      container: req.scope, environment, correlationId,
      work: () => service.consumeOAuthState({ stateHash: hashOAuthState(query.state), environment }),
    })
  } catch {
    redirect(res, environment, "failed")
    return
  }
  if (!attempt.current) {
    redirect(res, environment, "superseded")
    return
  }

  if (query.error) {
    const recorded = await withEbayLifecycleLock({
      container: req.scope, environment, actorId: attempt.actorId, correlationId,
      work: () => service.recordConnectionFailure({
        environment, attemptId: attempt.attemptId, actorId: attempt.actorId,
        category: EBAY_SAFE_ERROR.USER_DENIED, correlationId,
      }),
    }).catch(() => false)
    redirect(res, environment, recorded ? "denied" : "superseded")
    return
  }

  try {
    const config = resolveEbayEnvironmentConfig(environment)
    const client = resolveEbayOAuthClient(req.scope)
    const { token } = await client.exchangeAuthorisationCode(config, query.code as string, correlationId)
    const { identity } = await client.getIdentity(config, token.access_token, correlationId)
    const encryptedToken = encryptRefreshToken(token.refresh_token, resolveTokenEncryptionKeyring())
    const grantedScopes = resolveEbayGrantedScopes(token.scope)
    const connection = await withEbayLifecycleLock({
      container: req.scope, environment, actorId: attempt.actorId, correlationId,
      work: async () => {
        const completed = await service.completeConnection({
          environment, actorId: attempt.actorId, attemptId: attempt.attemptId,
          accountId: identity.userId, displayName: identity.username ?? null,
          encryptedToken, grantedScopes,
          accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000), correlationId,
        })
        if (completed) invalidateEbayAccessTokensForEnvironment(environment)
        return completed
      },
    })
    if (!connection) {
      // Deliberately discard an uninstalled token. RFC 7009 permits revoking a
      // token to invalidate related tokens or the grant, and eBay does not
      // document per-attempt isolation. See ADR 0014 for the future gate.
      redirect(res, environment, "superseded")
      return
    }
    redirect(res, environment, "connected")
  } catch (error) {
    const recorded = await withEbayLifecycleLock({
      container: req.scope, environment, actorId: attempt.actorId, correlationId,
      work: () => service.recordConnectionFailure({
        environment, attemptId: attempt.attemptId, actorId: attempt.actorId,
        category: safeRemoteCategory(error) as EbaySafeErrorCategory, correlationId,
      }),
    }).catch(() => false)
    redirect(res, environment, recorded ? "failed" : "superseded")
  }
}
