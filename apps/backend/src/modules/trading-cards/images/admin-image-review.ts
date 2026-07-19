import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { CARD_LANGUAGE } from "../types"

const IMAGE_NEED_STATUSES = ["MISSING", "PARTIAL", "READY"] as const

const optionalSearchSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(100).optional()
)

const tradingCardIdsSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean)).pipe(z.array(z.string()).min(1).max(200)).optional()
)

export const imageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  q: optionalSearchSchema,
  language: z.enum(Object.values(CARD_LANGUAGE) as [string, ...string[]]).optional(),
  status: z.enum(IMAGE_NEED_STATUSES).optional(),
  tradingCardIds: tradingCardIdsSchema,
}).strict()

export type ImageListQuery = z.infer<typeof imageListQuerySchema>

interface QueryExecutor {
  execute<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>
}

const countRowSchema = z.object({ count: z.coerce.number().int().min(0) }).strict()

const imageListRowSchema = z.object({
  trading_card_id: z.string(),
  card_name: z.string(),
  card_number: z.string(),
  card_set_id: z.string(),
  set_name: z.string(),
  language: z.string(),
  total_variant_count: z.coerce.number().int().min(0),
  variants_missing_images: z.coerce.number().int().min(0),
  ready_image_count: z.coerce.number().int().min(0),
}).strict()

function invalidStoredData(): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, "The stored card image review data is invalid.")
}

function parseStored<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) invalidStoredData()
  return result.data
}

function escapedLike(search: string): string {
  return `%${search.replace(/[\\%_]/gu, "\\$&")}%`
}

/**
 * `manager.execute`'s `?` placeholder substitution does not bind JS arrays
 * as Postgres array literals (unlike `knex.raw`, which does) — passing an
 * array straight to `= any(?)` here produces a malformed literal. Expanding
 * to one placeholder per value and using `in (...)` sidesteps that.
 */
function inClause(values: string[]): string {
  return `(${values.map(() => "?").join(", ")})`
}

function needStatus(row: z.infer<typeof imageListRowSchema>): (typeof IMAGE_NEED_STATUSES)[number] {
  if (row.variants_missing_images === 0) return "READY"
  if (row.variants_missing_images === row.total_variant_count) return "MISSING"
  return "PARTIAL"
}

function imageListItem(row: z.infer<typeof imageListRowSchema>) {
  return {
    trading_card_id: row.trading_card_id,
    card_name: row.card_name,
    card_number: row.card_number,
    card_set: { id: row.card_set_id, display_name: row.set_name, language: row.language },
    total_variant_count: row.total_variant_count,
    variants_missing_images: row.variants_missing_images,
    ready_image_count: row.ready_image_count,
    need_status: needStatus(row),
  }
}

const IMAGE_LIST_COLUMNS = `c.id as trading_card_id, c.name as card_name, c.card_number,
  s.id as card_set_id, s.display_name as set_name, s.language,
  count(distinct v.id) as total_variant_count,
  count(distinct v.id) filter (
    where not exists (
      select 1 from trading_card_image i
      where i.trading_card_variant_id = v.id and i.status = 'READY' and i.deleted_at is null
    )
  ) as variants_missing_images,
  coalesce(sum(
    (select count(*) from trading_card_image i2
     where i2.trading_card_variant_id = v.id and i2.status = 'READY' and i2.deleted_at is null)
  ), 0) as ready_image_count`

const IMAGE_LIST_FROM = `from trading_card c
  inner join trading_card_set s on s.id = c.card_set_id and s.deleted_at is null
  inner join trading_card_variant v on v.trading_card_id = c.id and v.deleted_at is null
  where c.deleted_at is null`

const IMAGE_LIST_GROUP_BY = `group by c.id, c.name, c.card_number, s.id, s.display_name, s.language`

function imageListWhereClauses(query: ImageListQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (query.tradingCardIds) {
    clauses.push(`c.id in ${inClause(query.tradingCardIds)}`)
    params.push(...query.tradingCardIds)
  }
  if (query.language) {
    clauses.push("s.language = ?")
    params.push(query.language)
  }
  if (query.q) {
    clauses.push(`(c.name ilike ? escape '\\' or s.display_name ilike ? escape '\\' or c.card_number ilike ? escape '\\')`)
    const search = escapedLike(query.q)
    params.push(search, search, search)
  }
  return { sql: clauses.length ? `and ${clauses.join(" and ")}` : "", params }
}

function imageListHavingClause(query: ImageListQuery): { sql: string; params: unknown[] } {
  if (query.status === "MISSING") {
    return { sql: "having count(distinct v.id) filter (where not exists (select 1 from trading_card_image i3 where i3.trading_card_variant_id = v.id and i3.status = 'READY' and i3.deleted_at is null)) = count(distinct v.id)", params: [] }
  }
  if (query.status === "READY") {
    return { sql: "having count(distinct v.id) filter (where not exists (select 1 from trading_card_image i3 where i3.trading_card_variant_id = v.id and i3.status = 'READY' and i3.deleted_at is null)) = 0", params: [] }
  }
  if (query.status === "PARTIAL") {
    return {
      sql: `having count(distinct v.id) filter (where not exists (select 1 from trading_card_image i3 where i3.trading_card_variant_id = v.id and i3.status = 'READY' and i3.deleted_at is null)) > 0
        and count(distinct v.id) filter (where not exists (select 1 from trading_card_image i3 where i3.trading_card_variant_id = v.id and i3.status = 'READY' and i3.deleted_at is null)) < count(distinct v.id)`,
      params: [],
    }
  }
  return { sql: "", params: [] }
}

export async function listCardsNeedingImages(executor: QueryExecutor, query: ImageListQuery) {
  const where = imageListWhereClauses(query)
  const having = imageListHavingClause(query)
  const [rows, countRows] = await Promise.all([
    executor.execute(
      `select ${IMAGE_LIST_COLUMNS} ${IMAGE_LIST_FROM} ${where.sql} ${IMAGE_LIST_GROUP_BY} ${having.sql}
       order by c.name asc, c.card_number asc limit ? offset ?`,
      [...where.params, ...having.params, query.limit, query.offset]
    ),
    executor.execute(
      `select count(*) as count from (
         select c.id ${IMAGE_LIST_FROM} ${where.sql} ${IMAGE_LIST_GROUP_BY} ${having.sql}
       ) as counted`,
      [...where.params, ...having.params]
    ),
  ])
  return {
    cards: rows.map((row) => imageListItem(parseStored(imageListRowSchema, row))),
    count: parseStored(countRowSchema, countRows[0]).count,
    limit: query.limit,
    offset: query.offset,
  }
}

const cardDetailRowSchema = z.object({
  trading_card_id: z.string(),
  card_name: z.string(),
  card_number: z.string(),
  card_set_id: z.string(),
  set_name: z.string(),
  language: z.string(),
}).strict()

export async function retrieveCardImageDetail(executor: QueryExecutor, tradingCardId: string) {
  const rows = await executor.execute(
    `select c.id as trading_card_id, c.name as card_name, c.card_number,
       s.id as card_set_id, s.display_name as set_name, s.language
     from trading_card c
     inner join trading_card_set s on s.id = c.card_set_id and s.deleted_at is null
     where c.id = ? and c.deleted_at is null`,
    [tradingCardId]
  )
  if (!rows[0]) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card not found")
  const card = parseStored(cardDetailRowSchema, rows[0])

  const variantRows = await executor.execute<{
    id: string; sku: string; condition: string; finish: string; special_treatment: string
  }>(
    `select id, sku, condition, finish, special_treatment from trading_card_variant
     where trading_card_id = ? and deleted_at is null order by id asc`,
    [tradingCardId]
  )

  const snapshotRows = await executor.execute<{ snapshot: unknown }>(
    `select snapshot from trading_card_tcgdex_enrichment_proposal
     where trading_card_id = ? and provider = 'TCGDEX' and deleted_at is null
     order by created_at desc limit 1`,
    [tradingCardId]
  )
  const snapshot = snapshotRows[0]?.snapshot as Record<string, unknown> | undefined
  const referenceArtworkUrl = typeof snapshot?.referenceArtworkUrl === "string" ? snapshot.referenceArtworkUrl : null

  return {
    trading_card: { id: card.trading_card_id, name: card.card_name, card_number: card.card_number },
    card_set: { id: card.card_set_id, display_name: card.set_name, language: card.language },
    tcgdex_reference_artwork_url: referenceArtworkUrl,
    variants: variantRows.map((row) => ({
      id: row.id, sku: row.sku, condition: row.condition, finish: row.finish, special_treatment: row.special_treatment,
    })),
  }
}

export interface VariantThumbnail {
  tradingCardId: string | null
  imageUrl: string | null
  source: "PHOTO" | "TCGDEX" | null
}

/**
 * Batched thumbnail lookup for a set of variants (used by the import
 * review table, which needs one small image per row without an N+1 query
 * per entry). A real, ready photograph always wins over the TCGdex
 * reference artwork — mirrors the primary/secondary image rule everywhere
 * else in the catalogue. Variants with neither get `imageUrl: null`, which
 * the caller renders as a placeholder. `tradingCardId` is included so the
 * frontend can open the full per-card image manager without a second
 * lookup; it is `null` only if the variant id itself does not resolve.
 */
export async function listThumbnailsForVariants(
  executor: QueryExecutor,
  variantIds: string[],
  derivePublicImageUrl: (objectKey: string) => string | null,
): Promise<Record<string, VariantThumbnail>> {
  const result: Record<string, VariantThumbnail> = {}
  for (const id of variantIds) result[id] = { tradingCardId: null, imageUrl: null, source: null }
  if (variantIds.length === 0) return result

  const variantRows = await executor.execute<{ id: string; trading_card_id: string }>(
    `select id, trading_card_id from trading_card_variant where id in ${inClause(variantIds)} and deleted_at is null`,
    variantIds
  )
  for (const row of variantRows) result[row.id].tradingCardId = row.trading_card_id

  const photoRows = await executor.execute<{ trading_card_variant_id: string; final_object_key: string }>(
    `select distinct on (trading_card_variant_id) trading_card_variant_id, final_object_key
     from trading_card_image
     where trading_card_variant_id in ${inClause(variantIds)} and status = 'READY' and deleted_at is null
     order by trading_card_variant_id, sort_order asc`,
    variantIds
  )
  const withoutPhoto: string[] = []
  for (const id of variantIds) {
    const photo = photoRows.find((row) => row.trading_card_variant_id === id)
    if (!photo) {
      withoutPhoto.push(id)
      continue
    }
    const imageUrl = derivePublicImageUrl(photo.final_object_key)
    if (imageUrl) result[id] = { ...result[id], imageUrl, source: "PHOTO" }
    else withoutPhoto.push(id)
  }

  if (withoutPhoto.length === 0) return result

  const tcgdexRows = await executor.execute<{ trading_card_variant_id: string; snapshot: unknown }>(
    `select v.id as trading_card_variant_id, p.snapshot
     from trading_card_variant v
     inner join lateral (
       select snapshot from trading_card_tcgdex_enrichment_proposal
       where trading_card_id = v.trading_card_id and provider = 'TCGDEX' and deleted_at is null
       order by created_at desc limit 1
     ) p on true
     where v.id in ${inClause(withoutPhoto)}`,
    withoutPhoto
  )
  for (const row of tcgdexRows) {
    const snapshot = row.snapshot as Record<string, unknown> | undefined
    const referenceArtworkUrl = typeof snapshot?.referenceArtworkUrl === "string" ? snapshot.referenceArtworkUrl : null
    if (referenceArtworkUrl) {
      result[row.trading_card_variant_id] = { ...result[row.trading_card_variant_id], imageUrl: referenceArtworkUrl, source: "TCGDEX" }
    }
  }
  return result
}
