import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { enrichmentSnapshotSchema, tradingCardIdSchema } from "./persistence-validation"

const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED", "APPLIED", "SUPERSEDED"] as const
const ATTEMPT_OUTCOMES = [
  "NO_MATCH",
  "UNRESOLVED_SET",
  "IDENTITY_MISMATCH",
  "INVALID_LOCAL_IDENTITY",
  "PROVIDER_ERROR",
] as const
const MATCH_SOURCES = ["AUTOMATIC", "MANUAL"] as const
const AUDIT_ACTIONS = [
  "TCGDEX_ENRICHMENT_RECORDED",
  "TCGDEX_ENRICHMENT_SUPERSEDED",
  "TCGDEX_ENRICHMENT_APPROVED",
  "TCGDEX_ENRICHMENT_REJECTED",
  "TCGDEX_ENRICHMENT_APPLIED",
] as const

const optionalSearchSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(100).optional()
)

const paginationSchema = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  q: optionalSearchSchema,
}

export const reviewListQuerySchema = z.object({
  ...paginationSchema,
  status: z.enum(REVIEW_STATUSES).optional(),
}).strict()

export const attemptListQuerySchema = z.object({
  ...paginationSchema,
  outcome: z.enum(ATTEMPT_OUTCOMES).optional(),
}).strict()

export const proposalIdParamsSchema = z.object({ proposalId: tradingCardIdSchema }).strict()
export const tradingCardIdParamsSchema = z.object({ tradingCardId: tradingCardIdSchema }).strict()

export const MAX_REJECT_REASON_LENGTH = 300
const rejectReasonSchema = z.string().trim().min(1).max(MAX_REJECT_REASON_LENGTH).refine(
  (value) => ![...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f),
  "Invalid reason"
)
export const rejectBodySchema = z.object({ reason: rejectReasonSchema.optional() }).strict()

export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>
export type AttemptListQuery = z.infer<typeof attemptListQuerySchema>
export type RejectBody = z.infer<typeof rejectBodySchema>

interface QueryExecutor {
  execute<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>
}

const databaseDateSchema = z.union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) => value instanceof Date ? value.toISOString() : value)
const nullableDatabaseDateSchema = databaseDateSchema.nullable()

const reviewRowSchema = z.object({
  id: z.string(), trading_card_id: z.string(), card_name: z.string(), card_number: z.string(),
  card_set_id: z.string(), set_name: z.string(), provider_set_code: z.string(), language: z.string(),
  provider_card_id: z.string(), provider_set_id: z.string(), review_status: z.enum(REVIEW_STATUSES),
  match_source: z.enum(MATCH_SOURCES), created_at: databaseDateSchema, updated_at: databaseDateSchema,
  reviewed_at: nullableDatabaseDateSchema, applied_at: nullableDatabaseDateSchema,
}).strict()

const attemptRowSchema = z.object({
  id: z.string(), trading_card_id: z.string(), card_name: z.string(), card_number: z.string(),
  card_set_id: z.string(), set_name: z.string(), provider_set_code: z.string(), language: z.string(),
  match_outcome: z.enum(ATTEMPT_OUTCOMES), match_source: z.enum(MATCH_SOURCES),
  provider_card_id: z.string().nullable(), provider_set_id: z.string().nullable(),
  safe_provider_error_code: z.string().max(128).nullable(),
  created_at: databaseDateSchema, updated_at: databaseDateSchema,
}).strict()

const singleReviewRowSchema = reviewRowSchema.extend({
  provider: z.literal("TCGDEX"), snapshot: z.unknown(), reviewer_id: z.string().max(128).nullable(),
  card_search_name: z.string(), rarity_raw: z.string().nullable(), rarity: z.string().nullable(),
  game: z.string(), release_date: nullableDatabaseDateSchema,
}).strict()

const auditRowSchema = z.object({
  id: z.string(), actor: z.string().max(128), action: z.enum(AUDIT_ACTIONS),
  source: z.enum(["MANUAL", "TCGDEX", "PULSE", "OTHER"]), created_at: databaseDateSchema,
}).strict()

const countRowSchema = z.object({ count: z.coerce.number().int().min(0) }).strict()

function invalidStoredData(): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, "The stored TCGdex review data is invalid.")
}

function parseStored<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) invalidStoredData()
  return result.data
}

function escapedLike(search: string): string {
  return `%${search.replace(/[\\%_]/gu, "\\$&")}%`
}

function identityFromRow(row: z.infer<typeof reviewRowSchema> | z.infer<typeof attemptRowSchema>) {
  return {
    trading_card: { id: row.trading_card_id, name: row.card_name, card_number: row.card_number },
    card_set: {
      id: row.card_set_id,
      display_name: row.set_name,
      provider_set_code: row.provider_set_code,
      language: row.language,
    },
  }
}

function reviewListItem(row: z.infer<typeof reviewRowSchema>) {
  return {
    id: row.id,
    ...identityFromRow(row),
    provider_card_id: row.provider_card_id,
    provider_set_id: row.provider_set_id,
    review_status: row.review_status,
    match_source: row.match_source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    applied_at: row.applied_at,
  }
}

const REVIEW_COLUMNS = `p.id, p.trading_card_id, c.name as card_name, c.card_number,
  s.id as card_set_id, s.display_name as set_name, s.provider_set_code, s.language,
  p.provider_card_id, p.provider_set_id, p.review_status, p.match_source,
  p.created_at, p.updated_at, p.reviewed_at, p.applied_at`
const REVIEW_FROM = `from trading_card_tcgdex_enrichment_proposal p
  inner join trading_card c on c.id = p.trading_card_id and c.deleted_at is null
  inner join trading_card_set s on s.id = c.card_set_id and s.deleted_at is null`

function reviewConditions(query: ReviewListQuery): { sql: string; params: unknown[] } {
  const clauses = ["p.provider = 'TCGDEX'", "p.deleted_at is null"]
  const params: unknown[] = []
  if (query.status) {
    clauses.push("p.review_status = ?")
    params.push(query.status)
  }
  if (query.q) {
    clauses.push(`(c.name ilike ? escape '\\' or s.display_name ilike ? escape '\\'
      or c.card_number ilike ? escape '\\' or p.provider_card_id ilike ? escape '\\'
      or p.provider_set_id ilike ? escape '\\')`)
    const search = escapedLike(query.q)
    params.push(search, search, search, search, search)
  }
  return { sql: clauses.join(" and "), params }
}

export async function listTcgdexReviews(executor: QueryExecutor, query: ReviewListQuery) {
  const conditions = reviewConditions(query)
  const [rows, countRows] = await Promise.all([
    executor.execute(`select ${REVIEW_COLUMNS} ${REVIEW_FROM} where ${conditions.sql}
      order by p.created_at desc, p.id desc limit ? offset ?`, [...conditions.params, query.limit, query.offset]),
    executor.execute(`select count(*) as count ${REVIEW_FROM} where ${conditions.sql}`, conditions.params),
  ])
  return {
    reviews: rows.map((row) => reviewListItem(parseStored(reviewRowSchema, row))),
    count: parseStored(countRowSchema, countRows[0]).count,
    limit: query.limit,
    offset: query.offset,
  }
}

export async function retrieveTcgdexReview(executor: QueryExecutor, proposalId: string) {
  const rows = await executor.execute(`select ${REVIEW_COLUMNS}, p.provider, p.snapshot, p.reviewer_id,
    c.search_name as card_search_name, c.rarity_raw, c.rarity, s.game, s.release_date
    ${REVIEW_FROM} where p.id = ? and p.provider = 'TCGDEX' and p.deleted_at is null`, [proposalId])
  if (!rows[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "TCGdex review proposal not found.")
  }
  const row = parseStored(singleReviewRowSchema, rows[0])
  const snapshotResult = enrichmentSnapshotSchema.safeParse(row.snapshot)
  if (!snapshotResult.success) invalidStoredData()
  const auditRows = await executor.execute(`select id, actor, action, source, created_at
    from trading_card_audit_entry
    where entity_type = 'ENRICHMENT_PROPOSAL' and entity_id = ? and action in (${AUDIT_ACTIONS.map(() => "?").join(", ")})
      and deleted_at is null
    order by created_at desc, id desc limit 50`, [proposalId, ...AUDIT_ACTIONS])

  return {
    review: {
      proposal: {
        id: row.id,
        provider: row.provider,
        provider_card_id: row.provider_card_id,
        provider_set_id: row.provider_set_id,
      },
      trading_card: {
        id: row.trading_card_id,
        name: row.card_name,
        search_name: row.card_search_name,
        card_number: row.card_number,
        rarity_raw: row.rarity_raw,
        rarity: row.rarity,
      },
      card_set: {
        id: row.card_set_id,
        game: row.game,
        language: row.language,
        display_name: row.set_name,
        provider_set_code: row.provider_set_code,
        release_date: row.release_date,
      },
      snapshot: snapshotResult.data,
      review_status: row.review_status,
      match_source: row.match_source,
      reviewer_id: row.reviewer_id,
      timestamps: {
        created_at: row.created_at,
        updated_at: row.updated_at,
        reviewed_at: row.reviewed_at,
        applied_at: row.applied_at,
      },
      audit_history: auditRows.map((audit) => parseStored(auditRowSchema, audit)),
    },
  }
}

function attemptConditions(query: AttemptListQuery): { sql: string; params: unknown[] } {
  const clauses = ["a.provider = 'TCGDEX'", "a.deleted_at is null", "a.match_outcome <> 'MATCHED'"]
  const params: unknown[] = []
  if (query.outcome) {
    clauses.push("a.match_outcome = ?")
    params.push(query.outcome)
  }
  if (query.q) {
    clauses.push(`(c.name ilike ? escape '\\' or s.display_name ilike ? escape '\\'
      or c.card_number ilike ? escape '\\' or a.provider_card_id ilike ? escape '\\'
      or a.provider_set_id ilike ? escape '\\')`)
    const search = escapedLike(query.q)
    params.push(search, search, search, search, search)
  }
  return { sql: clauses.join(" and "), params }
}

const ATTEMPT_FROM = `from trading_card_tcgdex_enrichment_attempt a
  inner join trading_card c on c.id = a.trading_card_id and c.deleted_at is null
  inner join trading_card_set s on s.id = c.card_set_id and s.deleted_at is null`

const ATTEMPT_COLUMNS = `a.id, a.trading_card_id, c.name as card_name, c.card_number,
  s.id as card_set_id, s.display_name as set_name, s.provider_set_code, s.language,
  a.match_outcome, a.match_source, a.provider_card_id, a.provider_set_id,
  a.safe_provider_error_code, a.created_at, a.updated_at`

function attemptListItem(row: z.infer<typeof attemptRowSchema>) {
  return {
    id: row.id,
    ...identityFromRow(row),
    outcome: row.match_outcome,
    match_source: row.match_source,
    provider_card_id: row.provider_card_id,
    provider_set_id: row.provider_set_id,
    safe_provider_error_code: row.safe_provider_error_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listTcgdexAttempts(executor: QueryExecutor, query: AttemptListQuery) {
  const conditions = attemptConditions(query)
  const [rows, countRows] = await Promise.all([
    executor.execute(`select ${ATTEMPT_COLUMNS}
      ${ATTEMPT_FROM} where ${conditions.sql}
      order by a.created_at desc, a.id desc limit ? offset ?`, [...conditions.params, query.limit, query.offset]),
    executor.execute(`select count(*) as count ${ATTEMPT_FROM} where ${conditions.sql}`, conditions.params),
  ])
  return {
    attempts: rows.map((value) => attemptListItem(parseStored(attemptRowSchema, value))),
    count: parseStored(countRowSchema, countRows[0]).count,
    limit: query.limit,
    offset: query.offset,
  }
}

/** Used internally by the retry action to shape a freshly recorded diagnostic attempt; not exposed as its own route. */
export async function retrieveTcgdexAttempt(executor: QueryExecutor, attemptId: string) {
  const rows = await executor.execute(`select ${ATTEMPT_COLUMNS}
    ${ATTEMPT_FROM} where a.id = ? and a.provider = 'TCGDEX' and a.deleted_at is null`, [attemptId])
  if (!rows[0]) throw new MedusaError(MedusaError.Types.NOT_FOUND, "TCGdex match attempt not found.")
  return attemptListItem(parseStored(attemptRowSchema, rows[0]))
}
