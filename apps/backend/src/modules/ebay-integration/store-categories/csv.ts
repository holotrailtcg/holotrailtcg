import { parse } from "csv-parse/sync"
import { z } from "@medusajs/framework/zod"

export const STORE_CATEGORY_CSV_HEADERS = ["ebay_store_category_id", "name", "parent_ebay_store_category_id", "sibling_order"] as const
const id = z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f,]+$/)
export const storeCategoryCsvRowSchema = z.object({
  ebay_store_category_id: id,
  name: z.string().trim().min(1).max(255),
  parent_ebay_store_category_id: z.string().trim().max(128),
  sibling_order: z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2_147_483_647)),
}).strict().transform((row) => ({ externalId: row.ebay_store_category_id, name: row.name, parentExternalId: row.parent_ebay_store_category_id || null, siblingOrder: row.sibling_order }))
export type StoreCategoryCsvRow = z.infer<typeof storeCategoryCsvRowSchema>

export function parseStoreCategoryCsv(csv: string): { rows: StoreCategoryCsvRow[]; errors: string[] } {
  if (Buffer.byteLength(csv, "utf8") > 1024 * 1024) return { rows: [], errors: ["The CSV exceeds the 1 MiB limit."] }
  try {
    const records = parse(csv, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: false, trim: false }) as Record<string, string>[]
    const header = csv.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]?.split(",") ?? []
    if (header.length !== STORE_CATEGORY_CSV_HEADERS.length || header.some((value, index) => value !== STORE_CATEGORY_CSV_HEADERS[index])) return { rows: [], errors: ["The CSV header must exactly match the documented schema."] }
    const rows: StoreCategoryCsvRow[] = []; const errors: string[] = []; const seen = new Set<string>()
    records.forEach((record, index) => { const parsed = storeCategoryCsvRowSchema.safeParse(record); if (!parsed.success) errors.push(`Row ${index + 2} is invalid.`); else if (seen.has(parsed.data.externalId)) errors.push(`Row ${index + 2} duplicates an eBay Store category ID.`); else { seen.add(parsed.data.externalId); rows.push(parsed.data) } })
    if (rows.length === 0 && errors.length === 0) errors.push("The CSV must contain at least one category.")
    return { rows, errors }
  } catch { return { rows: [], errors: ["The CSV is malformed."] } }
}
