import { createHash } from "node:crypto";
import {
  generateEntityId,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import EbayConnection from "./models/ebay-connection";
import EbayOAuthState from "./models/ebay-oauth-state";
import EbayConnectionAudit from "./models/ebay-connection-audit";
import EbayStoreCategory from "./models/ebay-store-category";
import EbayStoreCategoryAudit from "./models/ebay-store-category-audit";
import EbayStoreCategoryImportPreview from "./models/ebay-store-category-import-preview";
import EbayCategoryAssignmentRule from "./models/ebay-category-assignment-rule";
import EbayCategoryAssignmentSettings from "./models/ebay-category-assignment-settings";
import {
  EBAY_AUDIT_ACTION,
  EBAY_CONNECTION_STATUS,
  EBAY_OAUTH_STATE_CLEANUP_LIMIT,
  EBAY_OAUTH_STATE_RETENTION_HOURS,
  EBAY_SAFE_ERROR,
  type EbayConnectionStatus,
  EBAY_REFRESH_OPERATION_STALE_SECONDS,
  type EbayEnvironment,
  type EbaySafeErrorCategory,
  type CategoryAssignmentConditionField,
} from "./types";
import {
  evaluateCategoryAssignment,
  type CategoryAssignmentCardAttributes,
  type CategoryAssignmentResult,
  type CategoryAssignmentRule as CategoryAssignmentRuleInput,
} from "./category-assignment/evaluate";
import {
  parseStoreCategoryCsv,
  type StoreCategoryCsvRow,
} from "./store-categories/csv";
import type { EncryptedToken } from "./crypto/token-encryption";

interface TxManager {
  execute<T = Record<string, unknown>>(
    query: string,
    params?: unknown[],
  ): Promise<T[]>;
}
interface EntityManager extends TxManager {
  transactional<T>(callback: (manager: TxManager) => Promise<T>): Promise<T>;
}

export interface SafeEbayConnection {
  id: string;
  environment: EbayEnvironment;
  ebayAccountId: string | null;
  displayName: string | null;
  status: EbayConnectionStatus;
  grantedScopes: string[];
  accessTokenExpiresAt: Date | string | null;
  connectedAt: Date | string | null;
  disconnectedAt: Date | string | null;
  lastRefreshAt: Date | string | null;
  lastSafeErrorCategory: string | null;
}

export interface StoredCredentialMaterial extends EncryptedToken {
  connectionId: string;
  environment: EbayEnvironment;
  status: EbayConnectionStatus;
  credentialGeneration: string;
}

export interface ConsumedOAuthAttempt {
  id: string;
  actorId: string;
  attemptId: string;
  current: boolean;
}

interface AuditInput {
  connectionId?: string | null;
  environment: EbayEnvironment;
  actorId?: string | null;
  action: string;
  previousStatus?: string | null;
  resultingStatus?: string | null;
  safeOutcomeCategory?: string | null;
  correlationId: string;
}

function safeConnection(row: Record<string, unknown>): SafeEbayConnection {
  const scopes = Array.isArray(row.granted_scopes)
    ? row.granted_scopes.filter(
        (scope): scope is string => typeof scope === "string",
      )
    : [];
  return {
    id: row.id as string,
    environment: row.environment as EbayEnvironment,
    ebayAccountId: (row.ebay_account_id as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    status: row.status as EbayConnectionStatus,
    grantedScopes: scopes,
    accessTokenExpiresAt:
      (row.access_token_expires_at as Date | string | null) ?? null,
    connectedAt: (row.connected_at as Date | string | null) ?? null,
    disconnectedAt: (row.disconnected_at as Date | string | null) ?? null,
    lastRefreshAt: (row.last_refresh_at as Date | string | null) ?? null,
    lastSafeErrorCategory:
      (row.last_safe_error_category as string | null) ?? null,
  };
}

function storedCredential(
  row: Record<string, unknown>,
): StoredCredentialMaterial | null {
  if (
    !row.refresh_token_ciphertext ||
    !row.refresh_token_iv ||
    !row.refresh_token_auth_tag ||
    !row.encryption_key_version ||
    !row.credential_generation
  )
    return null;
  return {
    connectionId: row.id as string,
    environment: row.environment as EbayEnvironment,
    status: row.status as EbayConnectionStatus,
    credentialGeneration: row.credential_generation as string,
    ciphertext: row.refresh_token_ciphertext as string,
    iv: row.refresh_token_iv as string,
    authTag: row.refresh_token_auth_tag as string,
    keyVersion: row.encryption_key_version as string,
  };
}

export interface StoreCategoryDto {
  id: string;
  environment: EbayEnvironment;
  ebayAccountId: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
  siblingOrder: number;
  level: number;
  path: string;
  status: "ACTIVE" | "REMOVED";
  source: "MANUAL" | "CSV";
  updatedAt: Date | string;
  medusaCategoryId: string | null;
  medusaCategorySyncedAt: Date | string | null;
}
export interface StoreCategoryAuditDto {
  id: string;
  action: string;
  categoryId: string | null;
  actorId: string;
  correlationId: string;
  details: Record<string, unknown> | null;
  createdAt: Date | string;
}
type StoreScope = { environment: EbayEnvironment; ebayAccountId: string };
const categoryRow = (r: Record<string, unknown>): StoreCategoryDto => ({
  id: r.id as string,
  environment: r.environment as EbayEnvironment,
  ebayAccountId: r.ebay_account_id as string,
  externalId: r.external_id as string,
  name: r.name as string,
  parentExternalId: r.parent_external_id as string | null,
  siblingOrder: Number(r.sibling_order),
  level: Number(r.level),
  path: r.path as string,
  status: r.status as "ACTIVE" | "REMOVED",
  source: r.source as "MANUAL" | "CSV",
  updatedAt: r.updated_at as Date | string,
  medusaCategoryId: (r.medusa_category_id as string | null) ?? null,
  medusaCategorySyncedAt: (r.medusa_category_synced_at as Date | string | null) ?? null,
});
const categorySnapshot = (r: Record<string, unknown>) => ({
  externalId: String(r.external_id),
  name: String(r.name),
  parentExternalId: r.parent_external_id ? String(r.parent_external_id) : null,
  siblingOrder: Number(r.sibling_order),
  level: Number(r.level),
  status: String(r.status),
  source: String(r.source),
});
export interface RuleConditionInput {
  field: CategoryAssignmentConditionField;
  values: string[];
}
export interface CategoryAssignmentRuleDto {
  id: string;
  environment: EbayEnvironment;
  ebayAccountId: string;
  name: string;
  enabled: boolean;
  priority: number;
  targetStoreCategoryId: string;
  conditions: RuleConditionInput[];
  updatedAt: Date | string;
}
const assignmentRuleRow = (r: Record<string, unknown>): CategoryAssignmentRuleDto => ({
  id: r.id as string,
  environment: r.environment as EbayEnvironment,
  ebayAccountId: r.ebay_account_id as string,
  name: r.name as string,
  enabled: Boolean(r.enabled),
  priority: Number(r.priority),
  targetStoreCategoryId: r.target_store_category_id as string,
  conditions: (r.conditions as RuleConditionInput[]) ?? [],
  updatedAt: r.updated_at as Date | string,
});
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const PREVIEW_SUMMARY_ID_LIMIT = 500;
const PREVIEW_ERROR_LIMIT = 100;
const AUDIT_ID_LIMIT = 500;

function safeAuditDetails(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const details = value as Record<string, unknown>;
  const snapshot = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return undefined;
    const row = candidate as Record<string, unknown>;
    return {
      externalId: String(row.externalId ?? "").slice(0, 128),
      name: String(row.name ?? "").slice(0, 255),
      parentExternalId: row.parentExternalId
        ? String(row.parentExternalId).slice(0, 128)
        : null,
      siblingOrder: Number(row.siblingOrder),
      level: Number(row.level),
      status: String(row.status ?? "").slice(0, 16),
      source: String(row.source ?? "").slice(0, 16),
    };
  };
  const result: Record<string, unknown> = {};
  for (const key of ["previewId", "csvSha256", "rootExternalId", "ruleId", "name", "fallbackStoreCategoryId"] as const)
    if (typeof details[key] === "string")
      result[key] = details[key].slice(0, 128);
  if (details.fallbackStoreCategoryId === null) result.fallbackStoreCategoryId = null;
  for (const key of ["beforeStatus", "afterStatus"] as const)
    if (typeof details[key] === "string")
      result[key] = details[key].slice(0, 16);
  for (const key of ["rowCount", "invalidCount", "affectedCount", "priority", "scanned", "created", "updated", "unchanged", "failed"] as const)
    if (Number.isInteger(details[key])) result[key] = Number(details[key]);
  if (Array.isArray(details.failures))
    result.failures = details.failures.slice(0, 100).map((failure) => {
      const row = failure as Record<string, unknown>;
      return {
        categoryId: String(row.categoryId ?? "").slice(0, 128),
        externalId: String(row.externalId ?? "").slice(0, 128),
        message: String(row.message ?? "").slice(0, 500),
      };
    });
  if (typeof details.reason === "string")
    result.reason = details.reason.slice(0, 500);
  if (typeof details.truncated === "boolean")
    result.truncated = details.truncated;
  const before = snapshot(details.before);
  if (before) result.before = before;
  const after = snapshot(details.after);
  if (after) result.after = after;
  if (
    details.counts &&
    typeof details.counts === "object" &&
    !Array.isArray(details.counts)
  )
    result.counts = Object.fromEntries(
      Object.entries(details.counts as Record<string, unknown>)
        .filter(([, count]) => Number.isInteger(count))
        .slice(0, 8)
        .map(([key, count]) => [key.slice(0, 32), Number(count)]),
    );
  if (
    details.ids &&
    typeof details.ids === "object" &&
    !Array.isArray(details.ids)
  )
    result.ids = Object.fromEntries(
      Object.entries(details.ids as Record<string, unknown>)
        .slice(0, 8)
        .map(([key, ids]) => [
          key.slice(0, 32),
          Array.isArray(ids)
            ? ids.slice(0, AUDIT_ID_LIMIT).map((id) => String(id).slice(0, 128))
            : [],
        ]),
    );
  if (Array.isArray(details.affectedIds))
    result.affectedIds = details.affectedIds
      .slice(0, AUDIT_ID_LIMIT)
      .map((id) => String(id).slice(0, 128));
  return result;
}

class EbayIntegrationModuleService extends MedusaService({
  EbayConnection,
  EbayOAuthState,
  EbayConnectionAudit,
  EbayStoreCategory,
  EbayStoreCategoryAudit,
  EbayStoreCategoryImportPreview,
  EbayCategoryAssignmentRule,
  EbayCategoryAssignmentSettings,
}) {
  protected manager_: EntityManager;

  // Test-only hook so integration tests can observe the real transaction
  // manager that holds the category advisory lock (e.g. to read
  // pg_backend_pid()). Gated on NODE_ENV so it is inert in production and is
  // not reachable via any Admin/public API surface.
  private static testLockObserver:
    | ((manager: TxManager) => Promise<void> | void)
    | undefined;

  static async __setTestLockObserver(
    observer: ((manager: TxManager) => Promise<void> | void) | undefined,
  ): Promise<void> {
    if (process.env.NODE_ENV !== "test") return;
    EbayIntegrationModuleService.testLockObserver = observer;
  }

  constructor(container: { manager: EntityManager }) {
    // @ts-ignore MedusaService's generated constructor accepts the module container.
    super(...arguments);
    this.manager_ = container.manager;
  }

  private blocked = (): never => {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "eBay integration records are domain-owned",
    );
  };

  createEbayConnections = async (): Promise<never> => this.blocked();
  updateEbayConnections = async (): Promise<never> => this.blocked();
  deleteEbayConnections = async (): Promise<never> => this.blocked();
  softDeleteEbayConnections = async (): Promise<never> => this.blocked();
  restoreEbayConnections = async (): Promise<never> => this.blocked();
  createEbayStoreCategories = async (): Promise<never> => this.blocked();
  updateEbayStoreCategories = async (): Promise<never> => this.blocked();
  deleteEbayStoreCategories = async (): Promise<never> => this.blocked();
  softDeleteEbayStoreCategories = async (): Promise<never> => this.blocked();
  restoreEbayStoreCategories = async (): Promise<never> => this.blocked();
  createEbayStoreCategoryAudits = async (): Promise<never> => this.blocked();
  updateEbayStoreCategoryAudits = async (): Promise<never> => this.blocked();
  deleteEbayStoreCategoryAudits = async (): Promise<never> => this.blocked();
  softDeleteEbayStoreCategoryAudits = async (): Promise<never> =>
    this.blocked();
  restoreEbayStoreCategoryAudits = async (): Promise<never> => this.blocked();
  createEbayOAuthStates = async (): Promise<never> => this.blocked();
  updateEbayOAuthStates = async (): Promise<never> => this.blocked();
  deleteEbayOAuthStates = async (): Promise<never> => this.blocked();
  softDeleteEbayOAuthStates = async (): Promise<never> => this.blocked();
  restoreEbayOAuthStates = async (): Promise<never> => this.blocked();
  createEbayConnectionAudits = async (): Promise<never> => this.blocked();
  updateEbayConnectionAudits = async (): Promise<never> => this.blocked();
  deleteEbayConnectionAudits = async (): Promise<never> => this.blocked();
  softDeleteEbayConnectionAudits = async (): Promise<never> => this.blocked();
  restoreEbayConnectionAudits = async (): Promise<never> => this.blocked();
  createEbayCategoryAssignmentRules = async (): Promise<never> => this.blocked();
  updateEbayCategoryAssignmentRules = async (): Promise<never> => this.blocked();
  deleteEbayCategoryAssignmentRules = async (): Promise<never> => this.blocked();
  softDeleteEbayCategoryAssignmentRules = async (): Promise<never> => this.blocked();
  restoreEbayCategoryAssignmentRules = async (): Promise<never> => this.blocked();
  createEbayCategoryAssignmentSettings = async (): Promise<never> => this.blocked();
  updateEbayCategoryAssignmentSettings = async (): Promise<never> => this.blocked();
  deleteEbayCategoryAssignmentSettings = async (): Promise<never> => this.blocked();
  softDeleteEbayCategoryAssignmentSettings = async (): Promise<never> => this.blocked();
  restoreEbayCategoryAssignmentSettings = async (): Promise<never> => this.blocked();

  private async writeAudit(
    manager: TxManager,
    input: AuditInput,
  ): Promise<void> {
    await manager.execute(
      `insert into ebay_integration_connection_audit
       (id, connection_id, environment, actor_id, action, previous_status, resulting_status,
        safe_outcome_category, correlation_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
      [
        generateEntityId(undefined, "ebaudit"),
        input.connectionId ?? null,
        input.environment,
        input.actorId ?? null,
        input.action,
        input.previousStatus ?? null,
        input.resultingStatus ?? null,
        input.safeOutcomeCategory ?? null,
        input.correlationId.slice(0, 128),
      ],
    );
  }

  private async categoryScope(
    manager: TxManager,
    environment: EbayEnvironment,
  ): Promise<StoreScope> {
    const [connection] = await manager.execute<Record<string, unknown>>(
      `select ebay_account_id from ebay_integration_connection where environment = ? and deleted_at is null`,
      [environment],
    );
    if (!connection?.ebay_account_id)
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "A connected eBay seller account is required for this catalogue.",
      );
    return { environment, ebayAccountId: connection.ebay_account_id as string };
  }
  private async categoryRows(
    manager: TxManager,
    scope: StoreScope,
    lock = false,
  ) {
    return manager.execute<Record<string, unknown>>(
      `select * from ebay_integration_store_category where environment = ? and ebay_account_id = ? and deleted_at is null order by level, sibling_order, external_id${lock ? " for update" : ""}`,
      [scope.environment, scope.ebayAccountId],
    );
  }
  private async acquireCategoryLock(
    manager: TxManager,
    scope: StoreScope,
  ): Promise<void> {
    await manager.execute(
      `select pg_advisory_xact_lock(hashtext('ebay-store-catalogue'), hashtext(?))`,
      [`${scope.environment}:${scope.ebayAccountId}`],
    );
    if (
      process.env.NODE_ENV === "test" &&
      EbayIntegrationModuleService.testLockObserver
    ) {
      await EbayIntegrationModuleService.testLockObserver(manager);
    }
  }
  private catalogueFingerprint(rows: Record<string, unknown>[]): string {
    const normalized = rows
      .filter((row) => row.status === "ACTIVE")
      .map((row) => ({
        externalId: String(row.external_id),
        name: String(row.name),
        parentExternalId: row.parent_external_id
          ? String(row.parent_external_id)
          : null,
        siblingOrder: Number(row.sibling_order),
        level: Number(row.level),
        path: String(row.path),
        source: String(row.source),
      }))
      .sort((left, right) => left.externalId.localeCompare(right.externalId));
    return sha256(JSON.stringify(normalized));
  }
  private validateTree(
    rows: Array<{
      externalId: string;
      name: string;
      parentExternalId: string | null;
      siblingOrder: number;
    }>,
    existing: Record<string, unknown>[],
  ) {
    const problems: string[] = [];
    const all = new Map(rows.map((r) => [r.externalId, r]));
    const existingIds = new Set(
      existing
        .filter((r) => r.status === "ACTIVE")
        .map((r) => r.external_id as string),
    );
    for (const row of rows)
      if (
        row.parentExternalId &&
        !all.has(row.parentExternalId) &&
        !existingIds.has(row.parentExternalId)
      )
        problems.push(`Category ${row.externalId} has a missing parent.`);
    const depth = (
      row: { externalId: string; parentExternalId: string | null },
      visiting = new Set<string>(),
    ): number => {
      if (visiting.has(row.externalId)) {
        problems.push(`Category ${row.externalId} is in a cycle.`);
        return 4;
      }
      if (!row.parentExternalId) return 1;
      const parent = all.get(row.parentExternalId);
      if (!parent) return 2;
      const next = new Set(visiting);
      next.add(row.externalId);
      return depth(parent, next) + 1;
    };
    for (const row of rows) {
      if (row.parentExternalId === row.externalId)
        problems.push(`Category ${row.externalId} cannot parent itself.`);
      if (depth(row) > 3)
        problems.push(`Category ${row.externalId} exceeds level 3.`);
    }
    return [...new Set(problems)];
  }

  async listStoreCategories(
    environment: EbayEnvironment,
  ): Promise<{ accountId: string; categories: StoreCategoryDto[] }> {
    const scope = await this.categoryScope(this.manager_, environment);
    return {
      accountId: scope.ebayAccountId,
      categories: (await this.categoryRows(this.manager_, scope)).map(
        categoryRow,
      ),
    };
  }
  async listStoreCategoryAudits(
    environment: EbayEnvironment,
    limit: number,
  ): Promise<{ accountId: string; audits: StoreCategoryAuditDto[] }> {
    const scope = await this.categoryScope(this.manager_, environment);
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const audits = await this.manager_.execute<Record<string, unknown>>(
      `select id,action,category_id,actor_id,correlation_id,details,created_at from ebay_integration_store_category_audit where environment=? and ebay_account_id=? and deleted_at is null order by created_at desc,id desc limit ?`,
      [scope.environment, scope.ebayAccountId, boundedLimit],
    );
    return {
      accountId: scope.ebayAccountId,
      audits: audits.map((audit) => ({
        id: String(audit.id),
        action: String(audit.action).slice(0, 64),
        categoryId: audit.category_id ? String(audit.category_id) : null,
        actorId: String(audit.actor_id).slice(0, 128),
        correlationId: String(audit.correlation_id).slice(0, 128),
        details: safeAuditDetails(audit.details),
        createdAt: audit.created_at as Date | string,
      })),
    };
  }
  async retrieveStoreCategoryImportPreviewScope(
    previewId: string,
    actorId: string,
  ): Promise<StoreScope> {
    const [preview] = await this.manager_.execute<Record<string, unknown>>(
      `select environment,ebay_account_id from ebay_integration_store_category_import_preview where id=? and actor_id=? and status='ACTIVE' and consumed_at is null and deleted_at is null and expires_at > now()`,
      [previewId, actorId],
    );
    if (!preview)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The import preview is no longer valid. Preview again.",
      );
    return {
      environment: preview.environment as EbayEnvironment,
      ebayAccountId: preview.ebay_account_id as string,
    };
  }
  async previewStoreCategoryCsv(input: {
    environment: EbayEnvironment;
    csv: string;
    actorId: string;
    correlationId: string;
  }) {
    const parsed = parseStoreCategoryCsv(input.csv);
    const scope = await this.categoryScope(this.manager_, input.environment);
    const current = await this.categoryRows(this.manager_, scope);
    const errors = [...parsed.errors, ...this.validateTree(parsed.rows, [])];
    const byId = new Map(current.map((r) => [r.external_id as string, r]));
    const added: string[] = [],
      changed: string[] = [],
      unchanged: string[] = [];
    for (const row of parsed.rows) {
      const old = byId.get(row.externalId);
      if (!old) added.push(row.externalId);
      else if (
        old.name !== row.name ||
        old.parent_external_id !== row.parentExternalId ||
        Number(old.sibling_order) !== row.siblingOrder ||
        old.status !== "ACTIVE"
      )
        changed.push(row.externalId);
      else unchanged.push(row.externalId);
    }
    const removed = current
      .filter(
        (r) =>
          r.status === "ACTIVE" &&
          !parsed.rows.some((row) => row.externalId === r.external_id),
      )
      .map((r) => r.external_id as string);
    const previewId = generateEntityId(undefined, "ebstorepreview");
    const summary = {
      valid: errors.length === 0,
      added: added.slice(0, PREVIEW_SUMMARY_ID_LIMIT),
      changed: changed.slice(0, PREVIEW_SUMMARY_ID_LIMIT),
      unchanged: unchanged.slice(0, PREVIEW_SUMMARY_ID_LIMIT),
      invalid: errors.slice(0, PREVIEW_ERROR_LIMIT),
      removed: removed.slice(0, PREVIEW_SUMMARY_ID_LIMIT),
      counts: {
        added: added.length,
        changed: changed.length,
        unchanged: unchanged.length,
        invalid: errors.length,
        removed: removed.length,
      },
      truncated:
        added.length > PREVIEW_SUMMARY_ID_LIMIT ||
        changed.length > PREVIEW_SUMMARY_ID_LIMIT ||
        unchanged.length > PREVIEW_SUMMARY_ID_LIMIT ||
        removed.length > PREVIEW_SUMMARY_ID_LIMIT ||
        errors.length > PREVIEW_ERROR_LIMIT,
    };
    await this.manager_.transactional(async (manager) => {
      await manager.execute(
        `insert into ebay_integration_store_category_import_preview (id,environment,ebay_account_id,actor_id,csv_sha256,catalogue_fingerprint,safe_summary,expires_at,created_at,updated_at) values (?,?,?,?,?,?,?::jsonb,now() + interval '15 minutes',now(),now())`,
        [
          previewId,
          scope.environment,
          scope.ebayAccountId,
          input.actorId,
          sha256(input.csv),
          this.catalogueFingerprint(current),
          JSON.stringify(summary),
        ],
      );
      await manager.execute(
        `insert into ebay_integration_store_category_audit (id, environment, ebay_account_id, actor_id, action, correlation_id, details, created_at, updated_at) values (?, ?, ?, ?, 'CSV_PREVIEW', ?, ?::jsonb, now(), now())`,
        [
          generateEntityId(undefined, "ebstoreaudit"),
          scope.environment,
          scope.ebayAccountId,
          input.actorId,
          input.correlationId.slice(0, 128),
          JSON.stringify({
            previewId,
            csvSha256: sha256(input.csv),
            rowCount: parsed.rows.length,
            invalidCount: errors.length,
          }),
        ],
      );
    });
    return { previewId, accountId: scope.ebayAccountId, ...summary };
  }
  async applyStoreCategoryCsv(input: {
    previewId: string;
    csv: string;
    actorId: string;
    correlationId: string;
  }) {
    const scope = await this.retrieveStoreCategoryImportPreviewScope(
      input.previewId,
      input.actorId,
    );
    return this.applyStoreCategoryCsvLocked(input, scope);
  }
  private async applyStoreCategoryCsvLocked(
    input: {
      previewId: string;
      csv: string;
      actorId: string;
      correlationId: string;
    },
    lockedScope: StoreScope,
  ) {
    const parsed = parseStoreCategoryCsv(input.csv);
    return this.manager_.transactional(async (manager) => {
      await this.acquireCategoryLock(manager, lockedScope);
      const [preview] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_store_category_import_preview where id=? and actor_id=? and status='ACTIVE' and consumed_at is null and deleted_at is null and expires_at > now() for update`,
        [input.previewId, input.actorId],
      );
      if (!preview || preview.csv_sha256 !== sha256(input.csv))
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The import preview is no longer valid. Preview again.",
        );
      const scope = {
        environment: preview.environment as EbayEnvironment,
        ebayAccountId: preview.ebay_account_id as string,
      };
      const current = await this.categoryRows(manager, scope, true);
      if (preview.catalogue_fingerprint !== this.catalogueFingerprint(current))
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The catalogue changed after preview. Preview again.",
        );
      const errors = [...parsed.errors, ...this.validateTree(parsed.rows, [])];
      if (errors.length)
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The Store category CSV is invalid.",
        );
      const old = new Map(current.map((r) => [r.external_id as string, r]));
      const levels = new Map<string, number>();
      const path = new Map<string, string>();
      const resolve = (row: StoreCategoryCsvRow): number => {
        if (levels.has(row.externalId)) return levels.get(row.externalId)!;
        const parent = row.parentExternalId
          ? parsed.rows.find(
              (candidate) => candidate.externalId === row.parentExternalId,
            )
          : undefined;
        const level = parent ? resolve(parent) + 1 : 1;
        levels.set(row.externalId, level);
        path.set(
          row.externalId,
          parent ? `${path.get(parent.externalId)} / ${row.name}` : row.name,
        );
        return level;
      };
      for (const row of parsed.rows) resolve(row);
      const outcomes = {
        added: [] as string[],
        changed: [] as string[],
        reactivated: [] as string[],
        removed: [] as string[],
      };
      const changes: Array<{
        action: string;
        categoryId: string;
        before: ReturnType<typeof categorySnapshot> | null;
        after: ReturnType<typeof categorySnapshot>;
      }> = [];
      for (const row of parsed.rows) {
        const saved = old.get(row.externalId);
        const after = categorySnapshot({
          external_id: row.externalId,
          name: row.name,
          parent_external_id: row.parentExternalId,
          sibling_order: row.siblingOrder,
          level: levels.get(row.externalId),
          status: "ACTIVE",
          source: "CSV",
        });
        if (saved) {
          const before = categorySnapshot(saved);
          const reactivated = saved.status === "REMOVED";
          const changed = JSON.stringify(before) !== JSON.stringify(after);
          await manager.execute(
            `update ebay_integration_store_category set name=?, parent_external_id=?, sibling_order=?, level=?, path=?, status='ACTIVE', removed_at=null, removed_by=null, removal_reason=null, source='CSV', updated_at=now() where id=?`,
            [
              row.name,
              row.parentExternalId,
              row.siblingOrder,
              levels.get(row.externalId),
              path.get(row.externalId),
              saved.id,
            ],
          );
          if (reactivated) {
            outcomes.reactivated.push(row.externalId);
            changes.push({
              action: "CSV_CATEGORY_REACTIVATED",
              categoryId: String(saved.id),
              before,
              after,
            });
          } else if (changed) {
            outcomes.changed.push(row.externalId);
            changes.push({
              action: "CSV_CATEGORY_CHANGED",
              categoryId: String(saved.id),
              before,
              after,
            });
          }
        } else {
          const id = generateEntityId(undefined, "ebstorecat");
          await manager.execute(
            `insert into ebay_integration_store_category (id,environment,ebay_account_id,external_id,name,parent_external_id,sibling_order,level,path,status,source,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,'ACTIVE','CSV',now(),now())`,
            [
              id,
              scope.environment,
              scope.ebayAccountId,
              row.externalId,
              row.name,
              row.parentExternalId,
              row.siblingOrder,
              levels.get(row.externalId),
              path.get(row.externalId),
            ],
          );
          outcomes.added.push(row.externalId);
          changes.push({
            action: "CSV_CATEGORY_ADDED",
            categoryId: id,
            before: null,
            after,
          });
        }
      }
      const ids = parsed.rows.map((row) => row.externalId);
      const retainedPlaceholders = ids.map(() => "?").join(", ");
      for (const removed of current.filter(
        (row) =>
          row.status === "ACTIVE" && !ids.includes(String(row.external_id)),
      )) {
        const before = categorySnapshot(removed);
        const after = { ...before, status: "REMOVED" };
        outcomes.removed.push(String(removed.external_id));
        changes.push({
          action: "CSV_CATEGORY_REMOVED",
          categoryId: String(removed.id),
          before,
          after,
        });
      }
      await manager.execute(
        `update ebay_integration_store_category set status='REMOVED', removed_at=now(), removed_by=?, removal_reason='Absent from complete CSV import', updated_at=now() where environment=? and ebay_account_id=? and status='ACTIVE' and external_id not in (${retainedPlaceholders})`,
        [input.actorId, scope.environment, scope.ebayAccountId, ...ids],
      );
      for (const change of changes)
        await manager.execute(
          `insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,category_id,correlation_id,details,created_at,updated_at) values (?,?,?,?,?,?,?,?::jsonb,now(),now())`,
          [
            generateEntityId(undefined, "ebstoreaudit"),
            scope.environment,
            scope.ebayAccountId,
            input.actorId,
            change.action,
            change.categoryId,
            input.correlationId.slice(0, 128),
            JSON.stringify({
              previewId: input.previewId,
              before: change.before,
              after: change.after,
            }),
          ],
        );
      for (const values of Object.values(outcomes)) values.sort();
      const auditIds = Object.fromEntries(
        Object.entries(outcomes).map(([key, values]) => [
          key,
          values.slice(0, AUDIT_ID_LIMIT),
        ]),
      );
      const truncated = Object.values(outcomes).some(
        (values) => values.length > AUDIT_ID_LIMIT,
      );
      await manager.execute(
        `insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,correlation_id,details,created_at,updated_at) values (?,?,?,?, 'CSV_IMPORT_APPLIED', ?, ?::jsonb,now(),now())`,
        [
          generateEntityId(undefined, "ebstoreaudit"),
          scope.environment,
          scope.ebayAccountId,
          input.actorId,
          input.correlationId.slice(0, 128),
          JSON.stringify({
            previewId: input.previewId,
            csvSha256: String(preview.csv_sha256),
            rowCount: parsed.rows.length,
            counts: Object.fromEntries(
              Object.entries(outcomes).map(([key, values]) => [
                key,
                values.length,
              ]),
            ),
            ids: auditIds,
            truncated,
          }),
        ],
      );
      await manager.execute(
        `update ebay_integration_store_category_import_preview set status='CONSUMED', consumed_at=now(), updated_at=now() where id=? and status='ACTIVE' and consumed_at is null`,
        [input.previewId],
      );
      return {
        environment: scope.environment,
        accountId: scope.ebayAccountId,
        categories: (await this.categoryRows(manager, scope)).map(categoryRow),
      };
    });
  }
  async createStoreCategory(input: {
    environment: EbayEnvironment;
    externalId: string;
    name: string;
    parentExternalId: string | null;
    siblingOrder: number;
    actorId: string;
    correlationId: string;
  }) {
    const scope = await this.categoryScope(this.manager_, input.environment);
    return this.createStoreCategoryLocked(input, scope);
  }
  private async createStoreCategoryLocked(
    input: {
      environment: EbayEnvironment;
      externalId: string;
      name: string;
      parentExternalId: string | null;
      siblingOrder: number;
      actorId: string;
      correlationId: string;
    },
    lockedScope: StoreScope,
  ) {
    return this.manager_.transactional(async (manager) => {
      await this.acquireCategoryLock(manager, lockedScope);
      const scope = await this.categoryScope(manager, input.environment);
      const current = await this.categoryRows(manager, scope, true);
      const errors = this.validateTree(
        [
          {
            externalId: input.externalId,
            name: input.name,
            parentExternalId: input.parentExternalId,
            siblingOrder: input.siblingOrder,
          },
        ],
        current,
      );
      if (
        errors.length ||
        current.some((r) => r.external_id === input.externalId)
      )
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The Store category is invalid.",
        );
      const parent = current.find(
        (r) => r.external_id === input.parentExternalId,
      );
      const level = parent ? Number(parent.level) + 1 : 1;
      const path = parent ? `${parent.path} / ${input.name}` : input.name;
      const id = generateEntityId(undefined, "ebstorecat");
      await manager.execute(
        `insert into ebay_integration_store_category (id,environment,ebay_account_id,external_id,name,parent_external_id,sibling_order,level,path,status,source,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,'ACTIVE','MANUAL',now(),now())`,
        [
          id,
          scope.environment,
          scope.ebayAccountId,
          input.externalId,
          input.name,
          input.parentExternalId,
          input.siblingOrder,
          level,
          path,
        ],
      );
      const saved = (await this.categoryRows(manager, scope)).find(
        (r) => r.id === id,
      )!;
      await manager.execute(
        `insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,category_id,correlation_id,details,created_at,updated_at) values (?,?,?,?, 'MANUAL_CREATED', ?, ?, ?::jsonb,now(),now())`,
        [
          generateEntityId(undefined, "ebstoreaudit"),
          scope.environment,
          scope.ebayAccountId,
          input.actorId,
          id,
          input.correlationId.slice(0, 128),
          JSON.stringify({ after: categorySnapshot(saved) }),
        ],
      );
      return categoryRow(saved);
    });
  }
  async removeStoreCategory(input: {
    environment: EbayEnvironment;
    id: string;
    reason: string;
    actorId: string;
    correlationId: string;
  }) {
    const scope = await this.categoryScope(this.manager_, input.environment);
    return this.removeStoreCategoryLocked(input, scope);
  }
  private async removeStoreCategoryLocked(
    input: {
      environment: EbayEnvironment;
      id: string;
      reason: string;
      actorId: string;
      correlationId: string;
    },
    lockedScope: StoreScope,
  ) {
    return this.manager_.transactional(async (manager) => {
      await this.acquireCategoryLock(manager, lockedScope);
      const scope = await this.categoryScope(manager, input.environment);
      const current = await this.categoryRows(manager, scope, true);
      const target = current.find(
        (row) => row.id === input.id && row.status === "ACTIVE",
      );
      if (!target)
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "Active Store category not found.",
        );
      const affected = await manager.execute<Record<string, unknown>>(
        `with recursive subtree as (select id,external_id from ebay_integration_store_category where id=? and environment=? and ebay_account_id=? and status='ACTIVE' and deleted_at is null union all select child.id,child.external_id from ebay_integration_store_category child join subtree parent on child.parent_external_id=parent.external_id where child.environment=? and child.ebay_account_id=? and child.status='ACTIVE' and child.deleted_at is null) select id,external_id from subtree order by external_id`,
        [
          input.id,
          scope.environment,
          scope.ebayAccountId,
          scope.environment,
          scope.ebayAccountId,
        ],
      );
      await manager.execute(
        `update ebay_integration_store_category set status='REMOVED', removed_at=now(), removed_by=?, removal_reason=?, updated_at=now() where environment=? and ebay_account_id=? and id in (${affected.map(() => "?").join(", ")})`,
        [
          input.actorId,
          input.reason,
          scope.environment,
          scope.ebayAccountId,
          ...affected.map((r) => r.id),
        ],
      );
      const affectedIds = affected.map((row) => String(row.external_id));
      await manager.execute(
        `insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,category_id,correlation_id,details,created_at,updated_at) values (?,?,?,?, 'LOCAL_REMOVED', ?, ?, ?::jsonb,now(),now())`,
        [
          generateEntityId(undefined, "ebstoreaudit"),
          scope.environment,
          scope.ebayAccountId,
          input.actorId,
          input.id,
          input.correlationId.slice(0, 128),
          JSON.stringify({
            rootExternalId: String(target.external_id),
            affectedCount: affectedIds.length,
            affectedIds: affectedIds.slice(0, AUDIT_ID_LIMIT),
            truncated: affectedIds.length > AUDIT_ID_LIMIT,
            beforeStatus: "ACTIVE",
            afterStatus: "REMOVED",
            reason: input.reason.slice(0, 500),
          }),
        ],
      );
      return { removed: affected.length };
    });
  }
  async updateStoreCategory(input: {
    environment: EbayEnvironment;
    id: string;
    name: string;
    parentExternalId: string | null;
    siblingOrder: number;
    actorId: string;
    correlationId: string;
  }) {
    const scope = await this.categoryScope(this.manager_, input.environment);
    return this.updateStoreCategoryLocked(input, scope);
  }
  private async updateStoreCategoryLocked(
    input: {
      environment: EbayEnvironment;
      id: string;
      name: string;
      parentExternalId: string | null;
      siblingOrder: number;
      actorId: string;
      correlationId: string;
    },
    lockedScope: StoreScope,
  ) {
    return this.manager_.transactional(async (manager) => {
      await this.acquireCategoryLock(manager, lockedScope);
      const scope = await this.categoryScope(manager, input.environment);
      const current = await this.categoryRows(manager, scope, true);
      const target = current.find(
        (r) => r.id === input.id && r.status === "ACTIVE",
      );
      if (!target)
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "Active Store category not found.",
        );
      const before = categorySnapshot(target);
      const next = current
        .filter((r) => r.status === "ACTIVE")
        .map((r) =>
          r.id === input.id
            ? {
                externalId: r.external_id as string,
                name: input.name,
                parentExternalId: input.parentExternalId,
                siblingOrder: input.siblingOrder,
              }
            : {
                externalId: r.external_id as string,
                name: r.name as string,
                parentExternalId: r.parent_external_id as string | null,
                siblingOrder: Number(r.sibling_order),
              },
        );
      const errors = this.validateTree(next, []);
      if (errors.length)
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The Store category update is invalid.",
        );
      const byId = new Map(next.map((r) => [r.externalId, r]));
      const levels = new Map<string, number>();
      const paths = new Map<string, string>();
      const resolve = (row: (typeof next)[number]): number => {
        if (levels.has(row.externalId)) return levels.get(row.externalId)!;
        const parent = row.parentExternalId
          ? byId.get(row.parentExternalId)
          : undefined;
        const level = parent ? resolve(parent) + 1 : 1;
        levels.set(row.externalId, level);
        paths.set(
          row.externalId,
          parent ? `${paths.get(parent.externalId)} / ${row.name}` : row.name,
        );
        return level;
      };
      for (const row of next) resolve(row);
      for (const row of next)
        await manager.execute(
          `update ebay_integration_store_category set name=?, parent_external_id=?, sibling_order=?, level=?, path=?, updated_at=now() where environment=? and ebay_account_id=? and external_id=?`,
          [
            row.name,
            row.parentExternalId,
            row.siblingOrder,
            levels.get(row.externalId),
            paths.get(row.externalId),
            scope.environment,
            scope.ebayAccountId,
            row.externalId,
          ],
        );
      const saved = (await this.categoryRows(manager, scope)).find(
        (r) => r.id === input.id,
      )!;
      await manager.execute(
        `insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,category_id,correlation_id,details,created_at,updated_at) values (?,?,?,?, 'MANUAL_EDITED', ?, ?, ?::jsonb,now(),now())`,
        [
          generateEntityId(undefined, "ebstoreaudit"),
          scope.environment,
          scope.ebayAccountId,
          input.actorId,
          input.id,
          input.correlationId.slice(0, 128),
          JSON.stringify({ before, after: categorySnapshot(saved) }),
        ],
      );
      return categoryRow(saved);
    });
  }

  // -------------------------------------------------------------------
  // E2B: Category assignment rules + fallback
  // -------------------------------------------------------------------

  async listCategoryAssignmentRules(environment: EbayEnvironment): Promise<CategoryAssignmentRuleDto[]> {
    const scope = await this.categoryScope(this.manager_, environment);
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select * from ebay_integration_category_assignment_rule where environment=? and ebay_account_id=? and deleted_at is null order by priority, id`,
      [scope.environment, scope.ebayAccountId],
    );
    return rows.map(assignmentRuleRow);
  }

  async createCategoryAssignmentRule(input: {
    environment: EbayEnvironment;
    name: string;
    enabled: boolean;
    priority: number;
    targetStoreCategoryId: string;
    conditions: RuleConditionInput[];
    actorId: string;
    correlationId: string;
  }): Promise<CategoryAssignmentRuleDto> {
    return this.manager_.transactional(async (manager) => {
      const scope = await this.categoryScope(manager, input.environment);
      await this.assertActiveCategory(manager, scope, input.targetStoreCategoryId);
      const id = generateEntityId(undefined, "ebcatrule");
      await manager.execute(
        `insert into ebay_integration_category_assignment_rule (id,environment,ebay_account_id,name,enabled,priority,target_store_category_id,conditions,created_at,updated_at) values (?,?,?,?,?,?,?,?::jsonb,now(),now())`,
        [id, scope.environment, scope.ebayAccountId, input.name, input.enabled, input.priority, input.targetStoreCategoryId, JSON.stringify(input.conditions)],
      );
      await this.writeCategoryAudit(manager, scope, { actorId: input.actorId, action: "RULE_CREATED", categoryId: input.targetStoreCategoryId, correlationId: input.correlationId, details: { ruleId: id, name: input.name, priority: input.priority } });
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from ebay_integration_category_assignment_rule where id=?`, [id]);
      return assignmentRuleRow(saved);
    });
  }

  async updateCategoryAssignmentRule(input: {
    environment: EbayEnvironment;
    id: string;
    name: string;
    enabled: boolean;
    priority: number;
    targetStoreCategoryId: string;
    conditions: RuleConditionInput[];
    actorId: string;
    correlationId: string;
  }): Promise<CategoryAssignmentRuleDto> {
    return this.manager_.transactional(async (manager) => {
      const scope = await this.categoryScope(manager, input.environment);
      await this.assertActiveCategory(manager, scope, input.targetStoreCategoryId);
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_category_assignment_rule where id=? and environment=? and ebay_account_id=? and deleted_at is null for update`,
        [input.id, scope.environment, scope.ebayAccountId],
      );
      if (!existing) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Category assignment rule not found.");
      await manager.execute(
        `update ebay_integration_category_assignment_rule set name=?, enabled=?, priority=?, target_store_category_id=?, conditions=?::jsonb, updated_at=now() where id=?`,
        [input.name, input.enabled, input.priority, input.targetStoreCategoryId, JSON.stringify(input.conditions), input.id],
      );
      await this.writeCategoryAudit(manager, scope, { actorId: input.actorId, action: "RULE_UPDATED", categoryId: input.targetStoreCategoryId, correlationId: input.correlationId, details: { ruleId: input.id, name: input.name, priority: input.priority } });
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from ebay_integration_category_assignment_rule where id=?`, [input.id]);
      return assignmentRuleRow(saved);
    });
  }

  async removeCategoryAssignmentRule(input: { environment: EbayEnvironment; id: string; actorId: string; correlationId: string }): Promise<void> {
    return this.manager_.transactional(async (manager) => {
      const scope = await this.categoryScope(manager, input.environment);
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_category_assignment_rule where id=? and environment=? and ebay_account_id=? and deleted_at is null for update`,
        [input.id, scope.environment, scope.ebayAccountId],
      );
      if (!existing) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Category assignment rule not found.");
      await manager.execute(`update ebay_integration_category_assignment_rule set deleted_at=now(), updated_at=now() where id=?`, [input.id]);
      await this.writeCategoryAudit(manager, scope, { actorId: input.actorId, action: "RULE_REMOVED", categoryId: existing.target_store_category_id as string, correlationId: input.correlationId, details: { ruleId: input.id, name: existing.name } });
    });
  }

  async getCategoryAssignmentSettings(environment: EbayEnvironment): Promise<{ fallbackStoreCategoryId: string | null }> {
    const scope = await this.categoryScope(this.manager_, environment);
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select * from ebay_integration_category_assignment_settings where environment=? and ebay_account_id=? and deleted_at is null`,
      [scope.environment, scope.ebayAccountId],
    );
    return { fallbackStoreCategoryId: (row?.fallback_store_category_id as string | null) ?? null };
  }

  async setCategoryAssignmentFallback(input: {
    environment: EbayEnvironment;
    fallbackStoreCategoryId: string | null;
    actorId: string;
    correlationId: string;
  }): Promise<{ fallbackStoreCategoryId: string | null }> {
    return this.manager_.transactional(async (manager) => {
      const scope = await this.categoryScope(manager, input.environment);
      if (input.fallbackStoreCategoryId) await this.assertActiveCategory(manager, scope, input.fallbackStoreCategoryId);
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select id from ebay_integration_category_assignment_settings where environment=? and ebay_account_id=? and deleted_at is null for update`,
        [scope.environment, scope.ebayAccountId],
      );
      if (existing) {
        await manager.execute(`update ebay_integration_category_assignment_settings set fallback_store_category_id=?, updated_at=now() where id=?`, [input.fallbackStoreCategoryId, existing.id]);
      } else {
        await manager.execute(
          `insert into ebay_integration_category_assignment_settings (id,environment,ebay_account_id,fallback_store_category_id,created_at,updated_at) values (?,?,?,?,now(),now())`,
          [generateEntityId(undefined, "ebcatsettings"), scope.environment, scope.ebayAccountId, input.fallbackStoreCategoryId],
        );
      }
      await this.writeCategoryAudit(manager, scope, { actorId: input.actorId, action: "FALLBACK_SET", categoryId: input.fallbackStoreCategoryId, correlationId: input.correlationId, details: { fallbackStoreCategoryId: input.fallbackStoreCategoryId } });
      return { fallbackStoreCategoryId: input.fallbackStoreCategoryId };
    });
  }

  private async assertActiveCategory(manager: TxManager, scope: StoreScope, categoryId: string): Promise<void> {
    const [row] = await manager.execute<Record<string, unknown>>(
      `select id from ebay_integration_store_category where id=? and environment=? and ebay_account_id=? and status='ACTIVE' and deleted_at is null`,
      [categoryId, scope.environment, scope.ebayAccountId],
    );
    if (!row) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The target Store category must be an active local category.");
  }

  private async writeCategoryAudit(
    manager: TxManager,
    scope: StoreScope,
    input: { actorId: string; action: string; categoryId: string | null; correlationId: string; details: Record<string, unknown> },
  ): Promise<void> {
    await manager.execute(
      `insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,category_id,correlation_id,details,created_at,updated_at) values (?,?,?,?,?,?,?,?::jsonb,now(),now())`,
      [generateEntityId(undefined, "ebstoreaudit"), scope.environment, scope.ebayAccountId, input.actorId, input.action, input.categoryId, input.correlationId.slice(0, 128), JSON.stringify(input.details)],
    );
  }

  /** Evaluates enabled rules + fallback against the given card attributes for the environment's single (account-scoped) rule set. Returns a proposal, or a "no proposal" result requiring a manual choice. */
  async evaluateCategoryAssignment(
    environment: EbayEnvironment,
    attributes: CategoryAssignmentCardAttributes,
  ): Promise<CategoryAssignmentResult> {
    const scope = await this.categoryScope(this.manager_, environment);
    const [rules, settings, activeRows] = await Promise.all([
      this.manager_.execute<Record<string, unknown>>(
        `select * from ebay_integration_category_assignment_rule where environment=? and ebay_account_id=? and deleted_at is null order by priority, id`,
        [scope.environment, scope.ebayAccountId],
      ),
      this.manager_.execute<Record<string, unknown>>(
        `select fallback_store_category_id from ebay_integration_category_assignment_settings where environment=? and ebay_account_id=? and deleted_at is null`,
        [scope.environment, scope.ebayAccountId],
      ),
      this.manager_.execute<Record<string, unknown>>(
        `select id from ebay_integration_store_category where environment=? and ebay_account_id=? and status='ACTIVE' and deleted_at is null`,
        [scope.environment, scope.ebayAccountId],
      ),
    ]);
    const ruleInputs: CategoryAssignmentRuleInput[] = rules.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      enabled: row.enabled as boolean,
      priority: Number(row.priority),
      targetStoreCategoryId: row.target_store_category_id as string,
      conditions: (row.conditions as { field: CategoryAssignmentConditionField; values: string[] }[]) ?? [],
    }));
    const activeIds = new Set(activeRows.map((row) => row.id as string));
    const fallbackId = (settings[0]?.fallback_store_category_id as string | null) ?? null;
    return evaluateCategoryAssignment(ruleInputs, fallbackId, activeIds, attributes);
  }

  /** Whether `categoryId` is currently an active local Store category — used to gate approval on a still-valid confirmed selection. */
  async isActiveStoreCategory(environment: EbayEnvironment, categoryId: string): Promise<boolean> {
    const scope = await this.categoryScope(this.manager_, environment);
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select id from ebay_integration_store_category where id=? and environment=? and ebay_account_id=? and status='ACTIVE' and deleted_at is null`,
      [categoryId, scope.environment, scope.ebayAccountId],
    );
    return Boolean(row);
  }

  /** The linked Medusa Product Category id for a local Store category, if it has been synchronised. */
  async medusaCategoryIdFor(environment: EbayEnvironment, categoryId: string): Promise<string | null> {
    const scope = await this.categoryScope(this.manager_, environment);
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select medusa_category_id from ebay_integration_store_category where id=? and environment=? and ebay_account_id=? and deleted_at is null`,
      [categoryId, scope.environment, scope.ebayAccountId],
    );
    return (row?.medusa_category_id as string | null) ?? null;
  }

  /**
   * Same lookup as `medusaCategoryIdFor`, without requiring the caller to
   * already know which environment the category belongs to — generated ids
   * are globally unique, so this is safe. Used by the cross-module
   * category-assignment Phase B sync (`medusa-inventory-sync.ts`), which
   * only has a bare confirmed category id to work from.
   */
  async medusaCategoryIdForId(categoryId: string): Promise<string | null> {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select medusa_category_id from ebay_integration_store_category where id=? and deleted_at is null`,
      [categoryId],
    );
    return (row?.medusa_category_id as string | null) ?? null;
  }

  // -------------------------------------------------------------------
  // E2B: Medusa Product Category synchronisation
  // -------------------------------------------------------------------

  /** All active local Store categories for the environment, in a safe create/update order (parents before children). */
  async listActiveStoreCategoriesForMedusaSync(environment: EbayEnvironment): Promise<StoreScope & { categories: StoreCategoryDto[] }> {
    const scope = await this.categoryScope(this.manager_, environment);
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select * from ebay_integration_store_category where environment=? and ebay_account_id=? and status='ACTIVE' and deleted_at is null order by level, sibling_order, external_id`,
      [scope.environment, scope.ebayAccountId],
    );
    return { ...scope, categories: rows.map(categoryRow) };
  }

  async linkStoreCategoryToMedusaCategory(id: string, medusaCategoryId: string): Promise<void> {
    await this.manager_.execute(
      `update ebay_integration_store_category set medusa_category_id=?, medusa_category_synced_at=now(), updated_at=now() where id=?`,
      [medusaCategoryId, id],
    );
  }

  async markStoreCategorySynced(id: string): Promise<void> {
    await this.manager_.execute(`update ebay_integration_store_category set medusa_category_synced_at=now(), updated_at=now() where id=?`, [id]);
  }

  async recordMedusaSyncAudit(input: {
    environment: EbayEnvironment;
    actorId: string;
    correlationId: string;
    summary: { scanned: number; created: number; updated: number; unchanged: number; failed: number };
    failures: Array<{ categoryId: string; externalId: string; message: string }>;
  }): Promise<void> {
    const scope = await this.categoryScope(this.manager_, input.environment);
    await this.writeCategoryAudit(this.manager_, scope, {
      actorId: input.actorId,
      action: input.failures.length > 0 ? "MEDUSA_SYNC_COMPLETED_WITH_FAILURES" : "MEDUSA_SYNC_COMPLETED",
      categoryId: null,
      correlationId: input.correlationId,
      details: { ...input.summary, failures: input.failures.slice(0, AUDIT_ID_LIMIT) },
    });
  }

  async listSafeConnections(): Promise<SafeEbayConnection[]> {
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select id, environment, ebay_account_id, display_name, status, granted_scopes,
              access_token_expires_at, connected_at, disconnected_at, last_refresh_at,
              last_safe_error_category
       from ebay_integration_connection where deleted_at is null order by environment`,
    );
    return rows.map(safeConnection);
  }

  async retrieveSafeConnectionByEnvironment(
    environment: EbayEnvironment,
  ): Promise<SafeEbayConnection | null> {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select id, environment, ebay_account_id, display_name, status, granted_scopes,
              access_token_expires_at, connected_at, disconnected_at, last_refresh_at,
              last_safe_error_category
       from ebay_integration_connection where environment = ? and deleted_at is null`,
      [environment],
    );
    return row ? safeConnection(row) : null;
  }

  async retrieveEnvironmentForConnection(
    connectionId: string,
  ): Promise<EbayEnvironment> {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select environment from ebay_integration_connection where id = ? and deleted_at is null`,
      [connectionId],
    );
    if (!row)
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "eBay connection not found",
      );
    return row.environment as EbayEnvironment;
  }

  private async cleanupOAuthStatesWithManager(
    manager: TxManager,
    limit: number,
  ): Promise<number> {
    const bounded = Math.max(
      1,
      Math.min(limit, EBAY_OAUTH_STATE_CLEANUP_LIMIT),
    );
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
      [
        EBAY_OAUTH_STATE_RETENTION_HOURS,
        EBAY_OAUTH_STATE_RETENTION_HOURS,
        bounded,
      ],
    );
    return rows.length;
  }

  async cleanupOAuthStates(
    limit = EBAY_OAUTH_STATE_CLEANUP_LIMIT,
  ): Promise<number> {
    return this.manager_.transactional((manager) =>
      this.cleanupOAuthStatesWithManager(manager, limit),
    );
  }

  async beginConnection(input: {
    environment: EbayEnvironment;
    actorId: string;
    attemptId: string;
    stateHash: string;
    expiresAt: Date;
    reconnect: boolean;
    correlationId: string;
  }): Promise<{ connection: SafeEbayConnection; stateId: string }> {
    return this.manager_.transactional(async (manager) => {
      await this.cleanupOAuthStatesWithManager(
        manager,
        EBAY_OAUTH_STATE_CLEANUP_LIMIT,
      );
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`,
        [input.environment],
      );
      if (existing?.status === EBAY_CONNECTION_STATUS.DISCONNECTING) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "This eBay environment is being disconnected.",
        );
      }
      const activeStatuses: string[] = [
        EBAY_CONNECTION_STATUS.CONNECTING,
        EBAY_CONNECTION_STATUS.CONNECTED,
        EBAY_CONNECTION_STATUS.DEGRADED,
        EBAY_CONNECTION_STATUS.REFRESH_REQUIRED,
      ];
      if (
        existing &&
        activeStatuses.includes(existing.status as string) &&
        !input.reconnect
      ) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "This eBay environment is already connected or connecting.",
        );
      }

      const connectionId =
        (existing?.id as string | undefined) ??
        generateEntityId(undefined, "ebconn");
      const previousStatus = (existing?.status as string | undefined) ?? null;
      if (existing) {
        await manager.execute(
          `update ebay_integration_connection set status = ?, current_attempt_id = ?,
             refresh_operation_id = null, refresh_operation_started_at = null,
             last_safe_error_category = null, updated_at = now() where id = ?`,
          [EBAY_CONNECTION_STATUS.CONNECTING, input.attemptId, connectionId],
        );
      } else {
        await manager.execute(
          `insert into ebay_integration_connection
           (id, environment, status, current_attempt_id, granted_scopes, created_at, updated_at)
           values (?, ?, ?, ?, ?::jsonb, now(), now())`,
          [
            connectionId,
            input.environment,
            EBAY_CONNECTION_STATUS.CONNECTING,
            input.attemptId,
            "[]",
          ],
        );
      }

      await manager.execute(
        `update ebay_integration_oauth_state set consumed_at = now(), updated_at = now()
         where environment = ? and consumed_at is null and deleted_at is null`,
        [input.environment],
      );
      const stateId = generateEntityId(undefined, "ebstate");
      await manager.execute(
        `insert into ebay_integration_oauth_state
         (id, environment, attempt_id, state_hash, initiating_actor_id, redirect_intent,
          expires_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, now(), now())`,
        [
          stateId,
          input.environment,
          input.attemptId,
          input.stateHash,
          input.actorId,
          "/app/settings/ebay",
          input.expiresAt,
        ],
      );
      await this.writeAudit(manager, {
        connectionId,
        environment: input.environment,
        actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.CONNECTION_STARTED,
        previousStatus,
        resultingStatus: EBAY_CONNECTION_STATUS.CONNECTING,
        correlationId: input.correlationId,
      });
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ?`,
        [connectionId],
      );
      return { connection: safeConnection(saved), stateId };
    });
  }

  async consumeOAuthState(input: {
    stateHash: string;
    environment: EbayEnvironment;
  }): Promise<ConsumedOAuthAttempt> {
    return this.manager_.transactional(async (manager) => {
      const [consumed] = await manager.execute<Record<string, unknown>>(
        `update ebay_integration_oauth_state set consumed_at = now(), updated_at = now()
         where state_hash = ? and environment = ? and consumed_at is null
           and expires_at > now() and deleted_at is null
         returning id, initiating_actor_id, attempt_id`,
        [input.stateHash, input.environment],
      );
      if (!consumed)
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "The eBay connection request is invalid or has expired.",
        );
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select current_attempt_id from ebay_integration_connection
         where environment = ? and deleted_at is null for update`,
        [input.environment],
      );
      return {
        id: consumed.id as string,
        actorId: consumed.initiating_actor_id as string,
        attemptId: consumed.attempt_id as string,
        current: connection?.current_attempt_id === consumed.attempt_id,
      };
    });
  }

  async completeConnection(input: {
    environment: EbayEnvironment;
    actorId: string;
    attemptId: string;
    accountId: string;
    displayName?: string | null;
    encryptedToken: EncryptedToken;
    grantedScopes: string[];
    accessTokenExpiresAt: Date;
    correlationId: string;
  }): Promise<SafeEbayConnection | null> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`,
        [input.environment],
      );
      if (
        !connection ||
        connection.status !== EBAY_CONNECTION_STATUS.CONNECTING ||
        connection.current_attempt_id !== input.attemptId
      )
        return null;
      await manager.execute(
        `update ebay_integration_connection set ebay_account_id = ?, display_name = ?, status = ?,
           credential_generation = ?, refresh_token_ciphertext = ?, refresh_token_iv = ?,
           refresh_token_auth_tag = ?, encryption_key_version = ?, granted_scopes = ?::jsonb,
           access_token_expires_at = ?, connected_at = now(), connected_by = ?, disconnected_at = null,
           disconnected_by = null, last_refresh_at = now(), last_safe_error_category = null,
           updated_at = now() where id = ? and current_attempt_id = ?`,
        [
          input.accountId,
          input.displayName ?? null,
          EBAY_CONNECTION_STATUS.CONNECTED,
          input.attemptId,
          input.encryptedToken.ciphertext,
          input.encryptedToken.iv,
          input.encryptedToken.authTag,
          input.encryptedToken.keyVersion,
          JSON.stringify(input.grantedScopes),
          input.accessTokenExpiresAt,
          input.actorId,
          connection.id,
          input.attemptId,
        ],
      );
      await this.writeAudit(manager, {
        connectionId: connection.id as string,
        environment: input.environment,
        actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.CONNECTION_COMPLETED,
        previousStatus: connection.status as string,
        resultingStatus: EBAY_CONNECTION_STATUS.CONNECTED,
        correlationId: input.correlationId,
      });
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ?`,
        [connection.id],
      );
      return safeConnection(saved);
    });
  }

  async recordConnectionFailure(input: {
    environment: EbayEnvironment;
    attemptId: string;
    actorId?: string | null;
    category: EbaySafeErrorCategory;
    correlationId: string;
  }): Promise<boolean> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`,
        [input.environment],
      );
      if (
        !connection ||
        connection.current_attempt_id !== input.attemptId ||
        connection.status !== EBAY_CONNECTION_STATUS.CONNECTING
      )
        return false;
      const resultingStatus = storedCredential(connection)
        ? EBAY_CONNECTION_STATUS.DEGRADED
        : EBAY_CONNECTION_STATUS.ERROR;
      await manager.execute(
        `update ebay_integration_connection set status = ?, last_safe_error_category = ?,
         updated_at = now() where id = ? and current_attempt_id = ?`,
        [resultingStatus, input.category, connection.id, input.attemptId],
      );
      await this.writeAudit(manager, {
        connectionId: connection.id as string,
        environment: input.environment,
        actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.CONNECTION_FAILED,
        previousStatus: connection.status as string,
        resultingStatus,
        safeOutcomeCategory: input.category,
        correlationId: input.correlationId,
      });
      return true;
    });
  }

  async retrieveStoredCredential(
    connectionId: string,
  ): Promise<StoredCredentialMaterial> {
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select id, environment, status, credential_generation, refresh_token_ciphertext,
              refresh_token_iv, refresh_token_auth_tag, encryption_key_version
       from ebay_integration_connection where id = ? and deleted_at is null`,
      [connectionId],
    );
    const stored = row ? storedCredential(row) : null;
    if (!stored)
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No usable eBay connection credential exists.",
      );
    return stored;
  }

  async prepareCredentialRefresh(input: {
    connectionId: string;
    operationId: string;
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
        [
          input.operationId,
          input.connectionId,
          EBAY_CONNECTION_STATUS.CONNECTED,
          EBAY_CONNECTION_STATUS.DEGRADED,
          EBAY_REFRESH_OPERATION_STALE_SECONDS,
        ],
      );
      const stored = reserved ? storedCredential(reserved) : null;
      if (!stored)
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The eBay connection is unavailable or already refreshing.",
        );
      return stored;
    });
  }

  async recordRefreshSuccess(input: {
    connectionId: string;
    expectedGeneration: string;
    operationId: string;
    accessTokenExpiresAt: Date;
    grantedScopes?: string[];
    replacementToken?: EncryptedToken;
    correlationId: string;
  }): Promise<boolean> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ? and deleted_at is null for update`,
        [input.connectionId],
      );
      if (
        !connection ||
        connection.credential_generation !== input.expectedGeneration ||
        connection.refresh_operation_id !== input.operationId ||
        ![
          EBAY_CONNECTION_STATUS.CONNECTED,
          EBAY_CONNECTION_STATUS.DEGRADED,
        ].includes(connection.status as never)
      )
        return false;
      const replacement = input.replacementToken;
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
        [
          EBAY_CONNECTION_STATUS.CONNECTED,
          input.accessTokenExpiresAt,
          input.grantedScopes ? JSON.stringify(input.grantedScopes) : null,
          replacement?.ciphertext ?? null,
          replacement?.iv ?? null,
          replacement?.authTag ?? null,
          replacement?.keyVersion ?? null,
          input.connectionId,
          input.expectedGeneration,
          input.operationId,
        ],
      );
      await this.writeAudit(manager, {
        connectionId: input.connectionId,
        environment: connection.environment as EbayEnvironment,
        action: EBAY_AUDIT_ACTION.TOKEN_REFRESHED,
        previousStatus: connection.status as string,
        resultingStatus: EBAY_CONNECTION_STATUS.CONNECTED,
        correlationId: input.correlationId,
      });
      return true;
    });
  }

  async recordRefreshFailure(input: {
    connectionId: string;
    expectedGeneration: string;
    operationId: string;
    category: EbaySafeErrorCategory;
    correlationId: string;
  }): Promise<boolean> {
    const resultingStatus =
      input.category === EBAY_SAFE_ERROR.REFRESH_REQUIRED
        ? EBAY_CONNECTION_STATUS.REFRESH_REQUIRED
        : input.category === EBAY_SAFE_ERROR.TOKEN_DECRYPTION_FAILED
          ? EBAY_CONNECTION_STATUS.ERROR
          : EBAY_CONNECTION_STATUS.DEGRADED;
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ? and deleted_at is null for update`,
        [input.connectionId],
      );
      if (
        !connection ||
        connection.credential_generation !== input.expectedGeneration ||
        connection.refresh_operation_id !== input.operationId ||
        ![
          EBAY_CONNECTION_STATUS.CONNECTED,
          EBAY_CONNECTION_STATUS.DEGRADED,
        ].includes(connection.status as never)
      )
        return false;
      await manager.execute(
        `update ebay_integration_connection set status = ?, last_safe_error_category = ?,
         refresh_operation_id = null, refresh_operation_started_at = null, updated_at = now()
         where id = ? and credential_generation = ? and refresh_operation_id = ?`,
        [
          resultingStatus,
          input.category,
          input.connectionId,
          input.expectedGeneration,
          input.operationId,
        ],
      );
      await this.writeAudit(manager, {
        connectionId: input.connectionId,
        environment: connection.environment as EbayEnvironment,
        action: EBAY_AUDIT_ACTION.TOKEN_REFRESH_FAILED,
        previousStatus: connection.status as string,
        resultingStatus,
        safeOutcomeCategory: input.category,
        correlationId: input.correlationId,
      });
      return true;
    });
  }

  async beginDisconnect(environment: EbayEnvironment): Promise<{
    connection: SafeEbayConnection | null;
    credential: StoredCredentialMaterial | null;
    finished: boolean;
  }> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where environment = ? and deleted_at is null for update`,
        [environment],
      );
      if (!connection)
        return { connection: null, credential: null, finished: true };
      if (
        [
          EBAY_CONNECTION_STATUS.DISCONNECTED,
          EBAY_CONNECTION_STATUS.REVOKED,
        ].includes(connection.status as never)
      ) {
        return {
          connection: safeConnection(connection),
          credential: null,
          finished: true,
        };
      }
      await manager.execute(
        `update ebay_integration_connection set status = ?, current_attempt_id = null,
         refresh_operation_id = null, refresh_operation_started_at = null, updated_at = now() where id = ?`,
        [EBAY_CONNECTION_STATUS.DISCONNECTING, connection.id],
      );
      await manager.execute(
        `update ebay_integration_oauth_state set consumed_at = coalesce(consumed_at, now()), updated_at = now()
         where environment = ? and consumed_at is null and deleted_at is null`,
        [environment],
      );
      return {
        connection: safeConnection({
          ...connection,
          status: EBAY_CONNECTION_STATUS.DISCONNECTING,
        }),
        credential: storedCredential({
          ...connection,
          status: EBAY_CONNECTION_STATUS.DISCONNECTING,
        }),
        finished: false,
      };
    });
  }

  async completeDisconnect(input: {
    environment: EbayEnvironment;
    connectionId: string;
    expectedGeneration: string | null;
    actorId: string;
    remotelyRevoked: boolean;
    correlationId: string;
  }): Promise<SafeEbayConnection | null> {
    return this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ? and environment = ?
         and deleted_at is null for update`,
        [input.connectionId, input.environment],
      );
      if (
        !connection ||
        connection.status !== EBAY_CONNECTION_STATUS.DISCONNECTING ||
        ((connection.credential_generation as string | null) ?? null) !==
          input.expectedGeneration
      )
        return null;
      const status = input.remotelyRevoked
        ? EBAY_CONNECTION_STATUS.REVOKED
        : EBAY_CONNECTION_STATUS.DISCONNECTED;
      const category = input.remotelyRevoked
        ? null
        : EBAY_SAFE_ERROR.REVOCATION_UNCONFIRMED;
      await manager.execute(
        `update ebay_integration_connection set status = ?, current_attempt_id = null,
           credential_generation = null, refresh_token_ciphertext = null, refresh_token_iv = null,
           refresh_token_auth_tag = null, encryption_key_version = null, access_token_expires_at = null,
           disconnected_at = now(), disconnected_by = ?, last_safe_error_category = ?, updated_at = now()
         where id = ? and status = ?`,
        [
          status,
          input.actorId,
          category,
          connection.id,
          EBAY_CONNECTION_STATUS.DISCONNECTING,
        ],
      );
      await this.writeAudit(manager, {
        connectionId: connection.id as string,
        environment: input.environment,
        actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.DISCONNECTED,
        previousStatus: connection.status as string,
        resultingStatus: status,
        safeOutcomeCategory: category,
        correlationId: input.correlationId,
      });
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from ebay_integration_connection where id = ?`,
        [connection.id],
      );
      return safeConnection(saved);
    });
  }

  async recordLifecycleLockFailure(input: {
    environment: EbayEnvironment;
    actorId?: string | null;
    correlationId: string;
  }): Promise<void> {
    await this.manager_.transactional(async (manager) => {
      const [connection] = await manager.execute<Record<string, unknown>>(
        `select id, status from ebay_integration_connection where environment = ? and deleted_at is null`,
        [input.environment],
      );
      if (!connection) return;
      await this.writeAudit(manager, {
        connectionId: connection.id as string,
        environment: input.environment,
        actorId: input.actorId,
        action: EBAY_AUDIT_ACTION.LIFECYCLE_LOCK_FAILED,
        previousStatus: connection.status as string,
        resultingStatus: connection.status as string,
        safeOutcomeCategory: EBAY_SAFE_ERROR.LIFECYCLE_LOCK_FAILED,
        correlationId: input.correlationId,
      });
    });
  }
}

export default EbayIntegrationModuleService;
