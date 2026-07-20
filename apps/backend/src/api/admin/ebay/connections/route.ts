import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { randomUUID } from "node:crypto"
import { resolveEbayEnvironmentConfig } from "../../../../modules/ebay-integration/config"
import { buildEbayAuthorisationUrl } from "../../../../modules/ebay-integration/oauth/client"
import { generateOAuthState, hashOAuthState } from "../../../../modules/ebay-integration/oauth/state"
import { EBAY_OAUTH_STATE_TTL_MINUTES } from "../../../../modules/ebay-integration/types"
import { withEbayLifecycleLock } from "../../../../modules/ebay-integration/lifecycle-lock"
import { invalidateEbayAccessTokensForEnvironment } from "../../../../modules/ebay-integration/token-service"
import {
  adminActor, assertTrustedAdminOrigin, ebayIntegrationService, parseAdminInput,
  startConnectionBodySchema, statusPayload,
} from "./shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.status(200).json(await statusPayload(ebayIntegrationService(req)))
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  assertTrustedAdminOrigin(req)
  const body = parseAdminInput(startConnectionBodySchema, req.body ?? {})
  const config = resolveEbayEnvironmentConfig(body.environment)
  const state = generateOAuthState()
  const attemptId = randomUUID()
  const expiresAt = new Date(Date.now() + EBAY_OAUTH_STATE_TTL_MINUTES * 60_000)
  const correlationId = randomUUID()
  const actorId = adminActor(req)
  await withEbayLifecycleLock({
    container: req.scope, environment: body.environment, actorId, correlationId,
    work: async () => {
      await ebayIntegrationService(req).beginConnection({
        environment: body.environment, actorId, attemptId, stateHash: hashOAuthState(state),
        expiresAt, reconnect: body.reconnect, correlationId,
      })
      invalidateEbayAccessTokensForEnvironment(body.environment)
    },
  })
  res.status(201).json({
    environment: body.environment,
    authorisationUrl: buildEbayAuthorisationUrl(config, state),
    expiresAt: expiresAt.toISOString(),
  })
}
