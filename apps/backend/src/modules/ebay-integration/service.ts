import { generateEntityId, MedusaError, MedusaService } from "@medusajs/framework/utils"
import EbayConnection from "./models/ebay-connection"
import EbayOAuthState from "./models/ebay-oauth-state"
import EbayConnectionAudit from "./models/ebay-connection-audit"
import {
  EBAY_AUDIT_ACTION, EBAY_CONNECTION_STATUS, EBAY_OAUTH_STATE_CLEANUP_LIMIT,
  EBAY_OAUTH_STATE_RETENTION_HOURS, EBAY_SAFE_ERROR, type EbayConnectionStatus,
  EBAY_REFRESH_OPERATION_STALE_SECONDS, type EbayEnvironment, type EbaySafeErrorCategory,
} from "./types"
import type { EncryptedToken } from "./crypto/token-encryption"

interface TxManager {
  execute<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>
}
interface EntityManager extends TxManager {
  transactional<T>(callback: (manager: TxManager) => Promise<T>): Promise<T>
}

export interface SafeEbayConnection {
  id: string
  environment: EbayEnvironment
  ebayAccountId: string | null
  displayName: string | null
  status: EbayConnectionStatus
  grantedScopes: string[]
  accessTokenExpiresAt: Date | string | null
  connectedAt: Date | string | null
  disconnectedAt: Date | string | null
  lastRefreshAt: Date | string | null
  lastSafeErrorCategory: string | null
}

export interface StoredCredentialMaterial extends EncryptedToken {
  connectionId: string
  environment: EbayEnvironment
  status: EbayConnectionStatus
  credentialGeneration: string
}

export interface ConsumedOAuthAttempt {
  id: string
  actorId: string
  attemptId: string
  current: boolean
}

interface AuditInput {
  connectionId?: string | null
  environment: EbayEnvironment
  actorId?: string | null
  action: string
  previousStatus?: string | null
  resultingStatus?: string | null
  safeOutcomeCategory?: string | null
  correlationId: string
}

function safeConnection(row: Record<string, unknown>): SafeEbayConnection {
  const scopes = Array.isArray(row.granted_scopes)
    ? row.granted_scopes.filter((scope): scope is string => typeof scope === "string")
    : []
  return {
    id: row.id as string,
    environment: row.environment as EbayEnvironment,
    ebayAccountId: (row.ebay_account_id as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    status: row.status as EbayConnectionStatus,
    grantedScopes: scopes,
    accessTokenExpiresAt: (row.access_token_expires_at as Date | string | null) ?? null,
    connectedAt: (row.connected_at as Date | string | null) ?? null,
    disconnectedAt: (row.disconnected_at as Date | string | null) ?? null,
    lastRefreshAt: (row.last_refresh_at as Date | string | null) ?? null,
    lastSafeErrorCategory: (row.last_safe_error_category as string | null) ?? null,
  }
}

function storedCredential(row: Record<string, unknown>): StoredCredentialMaterial | null {
  if (!row.refresh_token_ciphertext || !row.refresh_token_iv || !row.refresh_token_auth_tag ||
      !row.encryption_key_version || !row.credential_generation) return null
  return {
    connectionId: row.id as string,
    environment: row.environment as EbayEnvironment,
    status: row.status as EbayConnectionStatus,
    credentialGeneration: row.credential_generation as string,
    ciphertext: row.refresh_token_ciphertext as string,
    iv: row.refresh_token_iv as string,
    authTag: row.refresh_token_auth_tag as string,
    keyVersion: row.encryption_key_version as string,
  }
}

class EbayIntegrationModuleService extends MedusaService({ EbayConnection, EbayOAuthState, EbayConnectionAudit }) {
  protected manager_: EntityManager

  constructor(container: { manager: EntityManager }) {
    // @ts-ignore MedusaService's generated constructor accepts the module container.
    super(...arguments)
    this.manager_ = container.manager
  }

  private blocked = (): never => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "eBay connection lifecycle records are domain-owned")
  }

  createEbayConnections = async (): Promise<never> => this.blocked()
  updateEbayConnections = async (): Promise<never> => this.blocked()
  deleteEbayConnections = async (): Promise<never> => this.blocked()
  softDeleteEbayConnections = async (): Promise<never> => this.blocked()
  restoreEbayConnections = async (): Promise<never> => this.blocked()
  createEbayOAuthStates = async (): Promise<never> => this.blocked()
  updateEbayOAuthStates = async (): Promise<never> => this.blocked()
  deleteEbayOAuthStates = async (): Promise<never> => this.blocked()
  softDeleteEbayOAuthStates = async (): Promise<never> => this.blocked()
  restoreEbayOAuthStates = async (): Promise<never> => this.blocked()
  createEbayConnectionAudits = async (): Promise<never> => this.blocked()
  updateEbayConnectionAudits = async (): Promise<never> => this.blocked()
  deleteEbayConnectionAudits = async (): Promise<never> => this.blocked()
  softDeleteEbayConnectionAudits = async (): Promise<never> => this.blocked()
  restoreEbayConnectionAudits = async (): Promise<never> => this.blocked()

  private async writeAudit(manager: TxManager, input: AuditInput): Promise<void> {
    await manager.execute(
      `insert into ebay_integration_connection_audit
       (id, connection_id, environment, actor_id, action, previous_status, resulting_status,
        safe_outcome_category, correlation_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
      [
        generateEntityId(undefined, "ebaudit"), input.connectionId ?? null, input.environment,
        input.actorId ?? null, input.action, input.previousStatus ?? null, input.resultingStatus ?? null,
        input.safeOutcomeCategory ?? null, input.correlationId.slice(0, 128),
      ]
    )
  }

  async listSafeConnections(): Promise<SafeEbayConnection[]> {
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select id, environment, ebay_account_id, display_name, status, granted_scopes,
              access_token_expires_at, connected_at, disconnected_at, last_refresh_at,
              last_safe_error_category
       from ebay_integration_connection where deleted_at is null order by environment`
    )
    return rows.map(safeConnection)
  }

  async retrieveSafeConnectionByEnvironment(environment: EbayEnvironment): Promise<SafeEbayConnection | null> {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select id, environment, ebay_account_id, display_name, status, granted_scopes,
              access_token_expires_at, connected_at, disconnected_at, last_refresh_at,
              last_safe_error_category
       from ebay_integration_connection where environment = ? and deleted_at is null`, [environment]
    )
    return row ? safeConnection(row) : null
  }

  async retrieveEnvironmentForConnection(connectionId: string): Promise<EbayEnvironment> {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select environment from ebay_integration_connection where id = ? and deleted_at is null`, [connectionId]
    )
    if (!row) throw new MedusaError(MedusaError.Types.NOT_FOUND, "eBay connection not found")
    return row.environment as EbayEnvironment
  }

  private async cleanupOAuthStatesWithManager(manager: TxManager, limit: number): Promise<number> {
    const bounded = Math.max(1, Math.min(limit, EBAY_OAUTH_STATE_CLEANUP_LIMIT))
    const rows = await manager.execute<Record<string, unknown>>(
      `delete from ebay_integration_oauth_state where id in (
         select state.id from ebay_integration_oauth_state state
         left join ebay_integration_connection connection
           on connection.environment = state.environment and connection.deleted_at is null
         where state.deleted_at is null
           and (state.expires_at < now() - (? * interval '1 hour')
             or state.consumed_at < now() - (? * interval '1 hour'))
           and not (state.consumed_at is null and state.expires_at > now()
             and connection.current_attempt_id = state.attempt_id)
         order by state.created_at asc, state.id asc limit ?
       ) returning id`,
      [EBAY_OAUTH_STATE_RETENTION_HOURS, EBAY_OAUTH_STATE_RETENTION_HOURS, bounded]
    )
    return rows.length
  }

  async cleanupOAuthStates(limit = EBAY_OAUTH_STATE_CLEANUP_LIMIT): Promise<number> {
    return this.manager_.transactional((manager) => this.cleanupOAuthStatesWithManager(manager, limit))
  }

  async beginConnection(input: {
    environment: EbayEnvironment
    actorId: string
    attemptId: string
    stateHash: string
    expiresAt: Date
    reconnect: boolean
    correlationId: string
  }): Promise<{ connection: SafeEbayConnection; stateId: string }> {
    return this.manager_.transactional(async (manager) => {
      await this.cleanupOAuthStatesWithManager(manager, EBAY_OAUTH_STATE_CLEANUP_LIMIT)
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`,
        [input.environment]
      )
      if (existing?.status === EBAY_CONNECTION_STATUS.DISCONNECTING) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This eBay environment is being disconnected.")
      }
      const activeStatuses: string[] = [
        EBAY_CONNECTION_STATUS.CONNECTING, EBAY_CONNECTION_STATUS.CONNECTED,
        EBAY_CONNECTION_STATUS.DEGRADED, EBAY_CONNECTION_STATUS.REFRESH_REQUIRED,
      ]
      if (existing && activeStatuses.includes(existing.status as string) && !input.reconnect) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This eBay environment is already connected or connecting.")
      }

      const connectionId = existing?.id as string | undefined ?? generateEntityId(undefined, "ebconn")
      const previousStatus = (existing?.status as string | undefined) ?? null
      if (existing) {
        await manager.execute(
          `update ebay_integration_connection set status = ?, current_attempt_id = ?,
             refresh_operation_id = null, refresh_operation_started_at = null,
             last_safe_error_category = null, updated_at = now() where id = ?`,
          [EBAY_CONNECTION_STATUS.CONNECTING, input.attemptId, connectionId]
        )
      } else {
        await manager.execute(
          `insert into ebay_integration_connection
           (id, environment, status, current_attempt_id, granted_scopes, created_at, updated_at)
           values (?, ?, ?, ?, ?::jsonb, now(), now())`,
          [connectionId, input.environment, EBAY_CONNECTION_STATUS.CONNECTING, input.attemptId, "[]"]
        )
      }

      await manager.execute(
        `update ebay_integration_oauth_state set consumed_at = now(), updated_at = now()
         where environment = ? and consumed_at is null and deleted_at is null`, [input.environment]
      )
      const stateId = generateEntityId(undefined, "ebstate")
      await manager.execute(
        `insert into ebay_integration_oauth_state
         (id, environment, attempt_id, state_hash, initiating_actor_id, redirect_intent,
          expires_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, now(), now())`,
        [stateId, input.environment, input.attemptId, input.stateHash, input.actorId,
          "/app/settings/ebay", input.expiresAt]
      )
      await this.writeAudit(manager, {
        connectionId, environment: input.environment, actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.CONNECTION_STARTED, previousStatus,
        resultingStatus: EBAY_CONNECTION_STATUS.CONNECTING, correlationId: input.correlationId,
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ?`, [connectionId]
      )
      return { connection: safeConnection(saved), stateId }
    })
  }

  async consumeOAuthState(input: { stateHash: string; environment: EbayEnvironment }): Promise<ConsumedOAuthAttempt> {
    return this.manager_.transactional(async (manager) => {
      const [consumed] = await manager.execute<Record<string, unknown>>(
        `update ebay_integration_oauth_state set consumed_at = now(), updated_at = now()
         where state_hash = ? and environment = ? and consumed_at is null
           and expires_at > now() and deleted_at is null
         returning id, initiating_actor_id, attempt_id`, [input.stateHash, input.environment]
      )
      if (!consumed) throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED, "The eBay connection request is invalid or has expired."
      )
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select current_attempt_id from ebay_integration_connection
         where environment = ? and deleted_at is null for update`, [input.environment]
      )
      return {
        id: consumed.id as string,
        actorId: consumed.initiating_actor_id as string,
        attemptId: consumed.attempt_id as string,
        current: connection?.current_attempt_id === consumed.attempt_id,
      }
    })
  }

  async completeConnection(input: {
    environment: EbayEnvironment
    actorId: string
    attemptId: string
    accountId: string
    displayName?: string | null
    encryptedToken: EncryptedToken
    grantedScopes: string[]
    accessTokenExpiresAt: Date
    correlationId: string
  }): Promise<SafeEbayConnection | null> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`,
        [input.environment]
      )
      if (!connection || connection.status !== EBAY_CONNECTION_STATUS.CONNECTING ||
          connection.current_attempt_id !== input.attemptId) return null
      await manager.execute(
        `update ebay_integration_connection set ebay_account_id = ?, display_name = ?, status = ?,
           credential_generation = ?, refresh_token_ciphertext = ?, refresh_token_iv = ?,
           refresh_token_auth_tag = ?, encryption_key_version = ?, granted_scopes = ?::jsonb,
           access_token_expires_at = ?, connected_at = now(), connected_by = ?, disconnected_at = null,
           disconnected_by = null, last_refresh_at = now(), last_safe_error_category = null,
           updated_at = now() where id = ? and current_attempt_id = ?`,
        [input.accountId, input.displayName ?? null, EBAY_CONNECTION_STATUS.CONNECTED, input.attemptId,
          input.encryptedToken.ciphertext, input.encryptedToken.iv, input.encryptedToken.authTag,
          input.encryptedToken.keyVersion, JSON.stringify(input.grantedScopes), input.accessTokenExpiresAt,
          input.actorId, connection.id, input.attemptId]
      )
      await this.writeAudit(manager, {
        connectionId: connection.id as string, environment: input.environment, actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.CONNECTION_COMPLETED, previousStatus: connection.status as string,
        resultingStatus: EBAY_CONNECTION_STATUS.CONNECTED, correlationId: input.correlationId,
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ?`, [connection.id]
      )
      return safeConnection(saved)
    })
  }

  async recordConnectionFailure(input: {
    environment: EbayEnvironment
    attemptId: string
    actorId?: string | null
    category: EbaySafeErrorCategory
    correlationId: string
  }): Promise<boolean> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`,
        [input.environment]
      )
      if (!connection || connection.current_attempt_id !== input.attemptId ||
          connection.status !== EBAY_CONNECTION_STATUS.CONNECTING) return false
      const resultingStatus = storedCredential(connection)
        ? EBAY_CONNECTION_STATUS.DEGRADED
        : EBAY_CONNECTION_STATUS.ERROR
      await manager.execute(
        `update ebay_integration_connection set status = ?, last_safe_error_category = ?,
         updated_at = now() where id = ? and current_attempt_id = ?`,
        [resultingStatus, input.category, connection.id, input.attemptId]
      )
      await this.writeAudit(manager, {
        connectionId: connection.id as string, environment: input.environment, actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.CONNECTION_FAILED, previousStatus: connection.status as string,
        resultingStatus, safeOutcomeCategory: input.category, correlationId: input.correlationId,
      })
      return true
    })
  }

  async retrieveStoredCredential(connectionId: string): Promise<StoredCredentialMaterial> {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select id, environment, status, credential_generation, refresh_token_ciphertext,
              refresh_token_iv, refresh_token_auth_tag, encryption_key_version
       from ebay_integration_connection where id = ? and deleted_at is null`, [connectionId]
    )
    const stored = row ? storedCredential(row) : null
    if (!stored) throw new MedusaError(MedusaError.Types.NOT_FOUND, "No usable eBay connection credential exists.")
    return stored
  }

  async prepareCredentialRefresh(input: {
    connectionId: string
    operationId: string
  }): Promise<StoredCredentialMaterial> {
    return this.manager_.transactional(async (manager) => {
      // PostgreSQL is the clock authority: this one conditional write either
      // acquires an empty reservation or displaces only a database-expired one.
      const [reserved] = await manager.execute<Record<string, unknown>>(
        `update ebay_integration_connection set refresh_operation_id = ?, refresh_operation_started_at = now(),
         updated_at = now()
         where id = ? and deleted_at is null
           and status in (?, ?)
           and refresh_token_ciphertext is not null and credential_generation is not null
           and (refresh_operation_id is null
             or refresh_operation_started_at <= now() - (? * interval '1 second'))
         returning *`,
        [input.operationId, input.connectionId, EBAY_CONNECTION_STATUS.CONNECTED,
          EBAY_CONNECTION_STATUS.DEGRADED, EBAY_REFRESH_OPERATION_STALE_SECONDS]
      )
      const stored = reserved ? storedCredential(reserved) : null
      if (!stored) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The eBay connection is unavailable or already refreshing.")
      return stored
    })
  }

  async recordRefreshSuccess(input: {
    connectionId: string
    expectedGeneration: string
    operationId: string
    accessTokenExpiresAt: Date
    grantedScopes?: string[]
    replacementToken?: EncryptedToken
    correlationId: string
  }): Promise<boolean> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ? and deleted_at is null for update`, [input.connectionId]
      )
      if (!connection || connection.credential_generation !== input.expectedGeneration ||
          connection.refresh_operation_id !== input.operationId ||
          ![EBAY_CONNECTION_STATUS.CONNECTED, EBAY_CONNECTION_STATUS.DEGRADED].includes(connection.status as never)) return false
      const replacement = input.replacementToken
      await manager.execute(
        `update ebay_integration_connection set status = ?, access_token_expires_at = ?, last_refresh_at = now(),
           granted_scopes = coalesce(?::jsonb, granted_scopes),
           refresh_token_ciphertext = coalesce(?, refresh_token_ciphertext),
           refresh_token_iv = coalesce(?, refresh_token_iv),
           refresh_token_auth_tag = coalesce(?, refresh_token_auth_tag),
           encryption_key_version = coalesce(?, encryption_key_version),
           refresh_operation_id = null, refresh_operation_started_at = null,
           last_safe_error_category = null, updated_at = now()
         where id = ? and credential_generation = ? and refresh_operation_id = ?`,
        [EBAY_CONNECTION_STATUS.CONNECTED, input.accessTokenExpiresAt,
          input.grantedScopes ? JSON.stringify(input.grantedScopes) : null,
          replacement?.ciphertext ?? null, replacement?.iv ?? null, replacement?.authTag ?? null,
          replacement?.keyVersion ?? null, input.connectionId, input.expectedGeneration, input.operationId]
      )
      await this.writeAudit(manager, {
        connectionId: input.connectionId, environment: connection.environment as EbayEnvironment,
        action: EBAY_AUDIT_ACTION.TOKEN_REFRESHED, previousStatus: connection.status as string,
        resultingStatus: EBAY_CONNECTION_STATUS.CONNECTED, correlationId: input.correlationId,
      })
      return true
    })
  }

  async recordRefreshFailure(input: {
    connectionId: string
    expectedGeneration: string
    operationId: string
    category: EbaySafeErrorCategory
    correlationId: string
  }): Promise<boolean> {
    const resultingStatus = input.category === EBAY_SAFE_ERROR.REFRESH_REQUIRED
      ? EBAY_CONNECTION_STATUS.REFRESH_REQUIRED
      : input.category === EBAY_SAFE_ERROR.TOKEN_DECRYPTION_FAILED
        ? EBAY_CONNECTION_STATUS.ERROR
        : EBAY_CONNECTION_STATUS.DEGRADED
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ? and deleted_at is null for update`, [input.connectionId]
      )
      if (!connection || connection.credential_generation !== input.expectedGeneration ||
          connection.refresh_operation_id !== input.operationId ||
          ![EBAY_CONNECTION_STATUS.CONNECTED, EBAY_CONNECTION_STATUS.DEGRADED].includes(connection.status as never)) return false
      await manager.execute(
        `update ebay_integration_connection set status = ?, last_safe_error_category = ?,
         refresh_operation_id = null, refresh_operation_started_at = null, updated_at = now()
         where id = ? and credential_generation = ? and refresh_operation_id = ?`,
        [resultingStatus, input.category, input.connectionId, input.expectedGeneration, input.operationId]
      )
      await this.writeAudit(manager, {
        connectionId: input.connectionId, environment: connection.environment as EbayEnvironment,
        action: EBAY_AUDIT_ACTION.TOKEN_REFRESH_FAILED, previousStatus: connection.status as string,
        resultingStatus, safeOutcomeCategory: input.category, correlationId: input.correlationId,
      })
      return true
    })
  }

  async beginDisconnect(environment: EbayEnvironment): Promise<{
    connection: SafeEbayConnection | null
    credential: StoredCredentialMaterial | null
    finished: boolean
  }> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`, [environment]
      )
      if (!connection) return { connection: null, credential: null, finished: true }
      if ([EBAY_CONNECTION_STATUS.DISCONNECTED, EBAY_CONNECTION_STATUS.REVOKED].includes(connection.status as never)) {
        return { connection: safeConnection(connection), credential: null, finished: true }
      }
      await manager.execute(
        `update ebay_integration_connection set status = ?, current_attempt_id = null,
         refresh_operation_id = null, refresh_operation_started_at = null, updated_at = now() where id = ?`,
        [EBAY_CONNECTION_STATUS.DISCONNECTING, connection.id]
      )
      await manager.execute(
        `update ebay_integration_oauth_state set consumed_at = coalesce(consumed_at, now()), updated_at = now()
         where environment = ? and consumed_at is null and deleted_at is null`, [environment]
      )
      return {
        connection: safeConnection({ ...connection, status: EBAY_CONNECTION_STATUS.DISCONNECTING }),
        credential: storedCredential({ ...connection, status: EBAY_CONNECTION_STATUS.DISCONNECTING }),
        finished: false,
      }
    })
  }

  async completeDisconnect(input: {
    environment: EbayEnvironment
    connectionId: string
    expectedGeneration: string | null
    actorId: string
    remotelyRevoked: boolean
    correlationId: string
  }): Promise<SafeEbayConnection | null> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ? and environment = ?
         and deleted_at is null for update`, [input.connectionId, input.environment]
      )
      if (!connection || connection.status !== EBAY_CONNECTION_STATUS.DISCONNECTING ||
          ((connection.credential_generation as string | null) ?? null) !== input.expectedGeneration) return null
      const status = input.remotelyRevoked ? EBAY_CONNECTION_STATUS.REVOKED : EBAY_CONNECTION_STATUS.DISCONNECTED
      const category = input.remotelyRevoked ? null : EBAY_SAFE_ERROR.REVOCATION_UNCONFIRMED
      await manager.execute(
        `update ebay_integration_connection set status = ?, current_attempt_id = null,
           credential_generation = null, refresh_token_ciphertext = null, refresh_token_iv = null,
           refresh_token_auth_tag = null, encryption_key_version = null, access_token_expires_at = null,
           disconnected_at = now(), disconnected_by = ?, last_safe_error_category = ?, updated_at = now()
         where id = ? and status = ?`,
        [status, input.actorId, category, connection.id, EBAY_CONNECTION_STATUS.DISCONNECTING]
      )
      await this.writeAudit(manager, {
        connectionId: connection.id as string, environment: input.environment, actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.DISCONNECTED, previousStatus: connection.status as string,
        resultingStatus: status, safeOutcomeCategory: category, correlationId: input.correlationId,
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ?`, [connection.id]
      )
      return safeConnection(saved)
    })
  }

  async recordLifecycleLockFailure(input: {
    environment: EbayEnvironment
    actorId?: string | null
    correlationId: string
  }): Promise<void> {
    await this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select id, status from ebay_integration_connection where environment = ? and deleted_at is null`,
        [input.environment]
      )
      if (!connection) return
      await this.writeAudit(manager, {
        connectionId: connection.id as string, environment: input.environment, actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.LIFECYCLE_LOCK_FAILED, previousStatus: connection.status as string,
        resultingStatus: connection.status as string, safeOutcomeCategory: EBAY_SAFE_ERROR.LIFECYCLE_LOCK_FAILED,
        correlationId: input.correlationId,
      })
    })
  }
}

export default EbayIntegrationModuleService
