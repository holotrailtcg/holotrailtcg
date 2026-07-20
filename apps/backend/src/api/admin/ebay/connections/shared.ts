import { randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import {
  ebayConnectionsEnabled, hasEbayEnvironmentConfig, isEbayEnvironment, resolveEbayEnvironmentConfig,
} from "../../../../modules/ebay-integration/config"
import { resolveTokenEncryptionKeyring, decryptRefreshToken } from "../../../../modules/ebay-integration/crypto/token-encryption"
import { resolveEbayOAuthClient } from "../../../../modules/ebay-integration/dependencies"
import { EBAY_INTEGRATION_MODULE } from "../../../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../../../modules/ebay-integration/service"
import { withEbayLifecycleLock } from "../../../../modules/ebay-integration/lifecycle-lock"
import { invalidateEbayAccessTokensForEnvironment } from "../../../../modules/ebay-integration/token-service"
import {
  EBAY_CONNECTION_STATUS, EBAY_ENVIRONMENT, EBAY_SAFE_ERROR, type EbayEnvironment,
} from "../../../../modules/ebay-integration/types"

export const environmentSchema = z.enum([EBAY_ENVIRONMENT.SANDBOX, EBAY_ENVIRONMENT.PRODUCTION])
export const startConnectionBodySchema = z.object({
  environment: environmentSchema,
  reconnect: z.boolean().default(false),
  confirmProduction: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.environment === EBAY_ENVIRONMENT.PRODUCTION && !value.confirmProduction) {
    context.addIssue({ code: "custom", message: "Production connection requires explicit confirmation." })
  }
})
export const disconnectBodySchema = z.object({
  environment: environmentSchema,
  confirm: z.literal(true),
  confirmProduction: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.environment === EBAY_ENVIRONMENT.PRODUCTION && !value.confirmProduction) {
    context.addIssue({ code: "custom", message: "Production disconnection requires explicit confirmation." })
  }
})
export const callbackParamsSchema = z.object({ environment: z.string().transform((value) => value.toUpperCase()) })
  .superRefine((value, context) => {
    if (!isEbayEnvironment(value.environment)) context.addIssue({ code: "custom", message: "Invalid environment." })
  })
  .transform((value) => ({ environment: value.environment as EbayEnvironment }))
export const callbackQuerySchema = z.object({
  state: z.string().min(16).max(256),
  code: z.string().min(1).max(1024).optional(),
  // eBay documents this on successful authorization redirects (normally
  // `expires_in=299`). It is authorization-code lifetime metadata, not the
  // later access-token lifetime, and is accepted only as a bounded integer.
  expires_in: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number)
    .pipe(z.number().int().positive().max(3600)).optional(),
  error: z.string().min(1).max(128).optional(),
  error_description: z.string().max(512).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.code) === Boolean(value.error)) context.addIssue({ code: "custom", message: "Invalid callback." })
})

export function ebayIntegrationService(req: MedusaRequest): EbayIntegrationModuleService {
  return req.scope.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
}

export function adminActor(req: AuthenticatedMedusaRequest): string {
  return req.auth_context.actor_id
}

export function parseAdminInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The request parameters are invalid.")
  return result.data
}

export function assertTrustedAdminOrigin(req: MedusaRequest): void {
  const origin = req.headers.origin
  const allowed = (process.env.ADMIN_CORS ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  if (!origin || !allowed.includes(origin)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The Admin request origin is not allowed.")
  }
}

export async function statusPayload(service: EbayIntegrationModuleService) {
  const connections = await service.listSafeConnections()
  return {
    enabled: ebayConnectionsEnabled(),
    environments: [EBAY_ENVIRONMENT.SANDBOX, EBAY_ENVIRONMENT.PRODUCTION].map((environment) => {
      const connection = connections.find((item) => item.environment === environment) ?? null
      return {
        environment,
        configured: ebayConnectionsEnabled() && hasEbayEnvironmentConfig(environment),
        connection,
        reconnectRequired: connection
          ? ([EBAY_CONNECTION_STATUS.REFRESH_REQUIRED, EBAY_CONNECTION_STATUS.REVOKED,
            EBAY_CONNECTION_STATUS.DISCONNECTED, EBAY_CONNECTION_STATUS.ERROR] as string[]).includes(connection.status)
          : false,
      }
    }),
  }
}

export async function disconnectEnvironment(req: AuthenticatedMedusaRequest, environment: EbayEnvironment) {
  const service = ebayIntegrationService(req)
  const actorId = adminActor(req)
  const correlationId = randomUUID()
  const prepared = await withEbayLifecycleLock({
    container: req.scope, environment, actorId, correlationId,
    work: async () => {
      invalidateEbayAccessTokensForEnvironment(environment)
      return service.beginDisconnect(environment)
    },
  })
  if (prepared.finished || !prepared.connection) return prepared.connection

  let remotelyRevoked = false
  if (prepared.credential) {
    try {
      const refreshToken = decryptRefreshToken(prepared.credential, resolveTokenEncryptionKeyring())
      await resolveEbayOAuthClient(req.scope).revokeRefreshToken(
        resolveEbayEnvironmentConfig(environment), refreshToken, correlationId
      )
      remotelyRevoked = true
    } catch {
      remotelyRevoked = false
    }
  }
  return withEbayLifecycleLock({
    container: req.scope, environment, actorId, correlationId,
    work: async () => {
      invalidateEbayAccessTokensForEnvironment(environment)
      return service.completeDisconnect({
        environment, connectionId: prepared.connection!.id,
        expectedGeneration: prepared.credential?.credentialGeneration ?? null,
        actorId, remotelyRevoked, correlationId,
      })
    },
  })
}

export function callbackResultUrl(environment: EbayEnvironment, result: "connected" | "denied" | "failed" | "superseded"): string {
  return `/app/settings/ebay?environment=${encodeURIComponent(environment)}&result=${result}`
}

export function safeRemoteCategory(error: unknown) {
  const candidate = error && typeof error === "object" && "category" in error
    ? String((error as { category: unknown }).category)
    : ""
  return (Object.values(EBAY_SAFE_ERROR) as string[]).includes(candidate)
    ? candidate
    : EBAY_SAFE_ERROR.INTERNAL_ERROR
}
