import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveEbayEnvironmentConfig } from "./config"
import { decryptRefreshToken, resolveTokenEncryptionKeyring } from "./crypto/token-encryption"
import { resolveEbayOAuthClient } from "./dependencies"
import { EBAY_INTEGRATION_MODULE } from "./index"
import { withEbayLifecycleLock } from "./lifecycle-lock"
import type EbayIntegrationModuleService from "./service"
import {
  EBAY_ACCESS_TOKEN_SAFETY_MARGIN_MS, EBAY_CONNECTION_STATUS, EBAY_SAFE_ERROR,
  resolveEbayGrantedScopes,
  type EbayEnvironment,
} from "./types"
import { EbayRemoteError } from "./oauth/client"
import type { EbayEnvironmentConfig } from "./config"
import type { TokenEncryptionKeyring } from "./crypto/token-encryption"
import type { EbayOAuthClient } from "./dependencies"

interface CachedAccessToken {
  token: string
  expiresAt: number
  environment: EbayEnvironment
  credentialGeneration: string
}

export interface EbayTokenService {
  getAccessToken(container: MedusaContainer, connectionId: string): Promise<string>
  invalidateConnection(connectionId: string): void
  invalidateEnvironment(environment: EbayEnvironment): void
}

export interface EbayTokenServiceDependencies {
  resolveConfig?: (environment: EbayEnvironment) => EbayEnvironmentConfig
  resolveClient?: (container: MedusaContainer) => EbayOAuthClient
  resolveKeyring?: () => TokenEncryptionKeyring
  /** Test seam for deterministic lifecycle races; production leaves this unset. */
  afterRefreshResponse?: () => Promise<void>
}

export function createEbayTokenService(dependencies: EbayTokenServiceDependencies = {}): EbayTokenService {
  const configFor = dependencies.resolveConfig ?? resolveEbayEnvironmentConfig
  const clientFor = dependencies.resolveClient ?? resolveEbayOAuthClient
  const keyringFor = dependencies.resolveKeyring ?? resolveTokenEncryptionKeyring
  const cache = new Map<string, CachedAccessToken>()
  const inFlight = new Map<string, Promise<string>>()

  const invalidateConnection = (connectionId: string) => cache.delete(connectionId)
  const invalidateEnvironment = (environment: EbayEnvironment) => {
    for (const [connectionId, entry] of cache) {
      if (entry.environment === environment) cache.delete(connectionId)
    }
  }

  const retrieveAccessToken = async (container: MedusaContainer, connectionId: string): Promise<string> => {
    const service = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
    const environment = await service.retrieveEnvironmentForConnection(connectionId)
    const correlationId = randomUUID()
    const operationId = randomUUID()

    const prepared = await withEbayLifecycleLock({
      container, environment, correlationId,
      work: async () => {
        const current = await service.retrieveStoredCredential(connectionId)
        if (![EBAY_CONNECTION_STATUS.CONNECTED, EBAY_CONNECTION_STATUS.DEGRADED].includes(current.status as never)) {
          invalidateConnection(connectionId)
          throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The eBay connection requires renewed authorisation.")
        }
        const cached = cache.get(connectionId)
        if (cached && cached.environment === environment &&
            cached.credentialGeneration === current.credentialGeneration &&
            cached.expiresAt - EBAY_ACCESS_TOKEN_SAFETY_MARGIN_MS > Date.now()) {
          return { cachedToken: cached.token, stored: null, refreshToken: null }
        }
        invalidateConnection(connectionId)
        const stored = await service.prepareCredentialRefresh({ connectionId, operationId })
        try {
          return {
            cachedToken: null,
            stored,
            refreshToken: decryptRefreshToken(stored, keyringFor()),
          }
        } catch {
          await service.recordRefreshFailure({
            connectionId, expectedGeneration: stored.credentialGeneration,
            operationId,
            category: EBAY_SAFE_ERROR.TOKEN_DECRYPTION_FAILED, correlationId,
          })
          throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The eBay connection credential could not be used.")
        }
      },
    })
    if (prepared.cachedToken) return prepared.cachedToken

    const stored = prepared.stored!
    try {
      const client = clientFor(container)
      const { token } = await client.refreshUserAccessToken(
        configFor(environment), prepared.refreshToken!, correlationId
      )
      await dependencies.afterRefreshResponse?.()
      const expiresAt = Date.now() + token.expires_in * 1000
      const scopes = resolveEbayGrantedScopes(token.scope)
      return await withEbayLifecycleLock({
        container, environment, correlationId,
        work: async () => {
          const persisted = await service.recordRefreshSuccess({
            connectionId, expectedGeneration: stored.credentialGeneration,
            operationId,
            accessTokenExpiresAt: new Date(expiresAt), grantedScopes: scopes, correlationId,
          })
          if (!persisted) {
            invalidateConnection(connectionId)
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The eBay connection changed while its token was refreshing.")
          }
          cache.set(connectionId, {
            token: token.access_token, expiresAt, environment,
            credentialGeneration: stored.credentialGeneration,
          })
          return token.access_token
        },
      })
    } catch (error) {
      invalidateConnection(connectionId)
      if (error instanceof MedusaError) throw error
      const category = error instanceof EbayRemoteError ? error.category : EBAY_SAFE_ERROR.INTERNAL_ERROR
      await withEbayLifecycleLock({
        container, environment, correlationId,
        work: () => service.recordRefreshFailure({
          connectionId, expectedGeneration: stored.credentialGeneration, category, correlationId,
          operationId,
        }),
      }).catch(() => undefined)
      throw new MedusaError(
        category === EBAY_SAFE_ERROR.REFRESH_REQUIRED ? MedusaError.Types.NOT_ALLOWED : MedusaError.Types.UNEXPECTED_STATE,
        `The eBay access token could not be refreshed (reference ${correlationId}).`
      )
    }
  }

  const getAccessToken = (container: MedusaContainer, connectionId: string): Promise<string> => {
    const existing = inFlight.get(connectionId)
    if (existing) return existing
    const task = retrieveAccessToken(container, connectionId)
      .finally(() => inFlight.delete(connectionId))
    inFlight.set(connectionId, task)
    return task
  }

  return { getAccessToken, invalidateConnection, invalidateEnvironment }
}

const defaultTokenService = createEbayTokenService()

export const getEbayAccessToken = defaultTokenService.getAccessToken
export const invalidateEbayAccessToken = defaultTokenService.invalidateConnection
export const invalidateEbayAccessTokensForEnvironment = defaultTokenService.invalidateEnvironment
