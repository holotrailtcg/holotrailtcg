import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { Migration20260716190000 } from "../migrations/Migration20260716190000"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import { importPulseCsvSnapshot } from "../../../workflows/trading-card-inventory/import-pulse-csv-snapshot"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let container: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inventory: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

async function applyMigration(migrationClass: new (a: never, b: never) => { up(): Promise<void>; getQueries(): unknown[] }) {
  const migration = new migrationClass(undefined as never, undefined as never)
  await migration.up()
  for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
}

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  // Only the newest migration this slice adds is re-applied here — see the
  // same note in pulse-import-service-methods.integration.spec.ts.
  await applyMigration(Migration20260716190000)
  medusaApp = await MedusaApp({
    modulesConfig: {
      [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" },
      [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards" },
    },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  inventory = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
  container = { resolve: (key: string) => (key === TRADING_CARD_INVENTORY_MODULE ? inventory : cards) }
}, 60000)

afterAll(async () => {
  // Other integration specs in this shared, persistent test database (e.g.
  // migration.integration.spec.ts) unconditionally re-run Stage 5A.2's
  // Migration20260716150000, whose `up()` re-narrows the audit-action CHECK
  // constraint to its pre-Slice-2 value list. Leaving an IMPORT_* audit row
  // behind would make that constraint re-add fail for every later test file
  // in the same run — clean up before closing the connection.
  await pgConnection.raw(`delete from trading_card_inventory_audit_entry where action like 'IMPORT_%'`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

async function createSource(overrides: Record<string, unknown> = {}) {
  const id = suffix()
  return inventory.createInventorySource({
    displayName: `Pulse Workflow Test Source ${id}`, provider: "PULSE", language: "EN",
    actor: "test-actor", source: "MANUAL", ...overrides,
  })
}

async function createMatchableVariant(cardNumber: string) {
  const id = suffix()
  const set = await cards.createCardSets({
    game: "POKEMON", language: "EN", display_name: `Pulse Workflow Test Set ${id}`, provider_set_code: `pulsewftest${id}`,
  })
  const card = await cards.createTradingCards({
    card_set_id: set.id, name: `Crobat ${id}`, search_name: `crobat ${id}`,
    card_number: cardNumber, card_number_normalised: cardNumber, origin: "PULSE",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT",
    finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
    sku: `POKEMON-EN-PULSEWFTEST-${cardNumber.replace(/\D/g, "")}-${id.toUpperCase()}`, origin: "PULSE",
  })
  return { set, card, variant }
}

const CSV_HEADER =
  "Product Name,Set,Card Number,Material,Promo Info,Rarity,Graded By,Grade,Item Type,Product ID,Quantity,Avg Cost,Market Price,Sticker Price,Total Cost,Total Market Value,Total Sticker Value,Profit,Margin %,Markup vs Market %"

function csvRow(fields: {
  productName?: string; setName?: string; cardNumber: string; material?: string; rarity?: string
  productId: string; quantity?: string; avgCost?: string; marketPrice?: string; stickerPrice?: string
}): string {
  return [
    fields.productName ?? "Crobat", fields.setName ?? "Test Set", fields.cardNumber, fields.material ?? "Holo", "",
    fields.rarity ?? "Common", "", "", "", fields.productId, fields.quantity ?? "2",
    fields.avgCost ?? "1.50", fields.marketPrice ?? "3.00", fields.stickerPrice ?? "4.00",
    "3.00", "6.00", "8.00", "5.00", "50%", "50%",
  ].join(",")
}

function csvBuffer(rows: string[]): Buffer {
  return Buffer.from([CSV_HEADER, ...rows].join("\n"), "utf-8")
}

const baseInput = { actor: "test-actor", source: "PULSE" as const, originalFilename: "import.csv", mimeType: "text/csv" }

describe("importPulseCsvSnapshot (cross-module integration)", () => {
  it("imports against an existing active source, matches a unique variant, creates a trusted reference, and reconciles", async () => {
    const source = await createSource()
    const cardNumber = `044/${suffix().slice(0, 3)}`
    const { variant } = await createMatchableVariant(cardNumber)
    const setCode = (await pgConnection.raw(
      `select cs.provider_set_code from trading_card_set cs
       inner join trading_card tc on tc.card_set_id = cs.id
       inner join trading_card_variant tv on tv.trading_card_id = tc.id
       where tv.id = ?`, [variant.id],
    )).rows[0].provider_set_code as string
    const fullProductId = `card:${setCode}|${cardNumber}|Holo|null|null|null|nm`

    const result = await importPulseCsvSnapshot(container, {
      ...baseInput, inventorySourceId: source.id,
      fileBuffer: csvBuffer([csvRow({ cardNumber, productId: fullProductId })]),
    })

    expect(result.kind).toBe("IMPORTED")
    if (result.kind !== "IMPORTED") throw new Error("expected IMPORTED")
    expect(result.snapshotStatus).toBe("PENDING_REVIEW")
    expect(result.importSummary.rowCount).toBe(1)
    expect(result.matchingSummary.MATCHED).toBe(1)
    expect(result.reconciliationSummary?.proposalCount).toBe(1)

    const { rows: matchRows } = await inventory.listSnapshotEntriesForAdmin(result.snapshotId, {}, { limit: 10, offset: 0 })
    expect(matchRows[0].trading_card_variant_id).toBe(variant.id)
    expect(matchRows[0].matching_status).toBe("MATCHED")

    const trusted = await cards.findTrustedExternalReference("PULSE", fullProductId)
    expect(trusted).toMatchObject({ tradingCardVariantId: variant.id })
  }, 60000)

  it("creates a new source when given a display name and provider", async () => {
    const id = suffix()
    const result = await importPulseCsvSnapshot(container, {
      ...baseInput, newSourceDisplayName: `Pulse New Source ${id}`, newSourceProvider: "PULSE", newSourceLanguage: "EN",
      fileBuffer: csvBuffer([csvRow({ cardNumber: "999/999", productId: "card:unknownset|999/999|Holo|null|null|null|nm" })]),
    })
    expect(result.kind).toBe("IMPORTED")
  }, 60000)

  it("returns DUPLICATE for a repeat upload of the same bytes to the same source, without creating a second snapshot", async () => {
    const source = await createSource()
    const buffer = csvBuffer([csvRow({ cardNumber: "111/222", productId: "card:dupset|111/222|Holo|null|null|null|nm" })])
    const first = await importPulseCsvSnapshot(container, { ...baseInput, inventorySourceId: source.id, fileBuffer: buffer })
    expect(first.kind).toBe("IMPORTED")
    const second = await importPulseCsvSnapshot(container, { ...baseInput, inventorySourceId: source.id, fileBuffer: buffer })
    expect(second).toMatchObject({ kind: "DUPLICATE", snapshotId: (first as { snapshotId: string }).snapshotId })
    const [{ count }] = (await pgConnection.raw(
      `select count(*)::int as count from trading_card_inventory_snapshot where inventory_source_id = ?`, [source.id],
    )).rows
    expect(count).toBe(1)
  }, 60000)

  it("returns SOURCE_ARCHIVED and creates no snapshot for an archived source", async () => {
    const source = await createSource()
    await inventory.archiveInventorySource({ id: source.id, actor: "test-actor", source: "MANUAL" })
    const result = await importPulseCsvSnapshot(container, {
      ...baseInput, inventorySourceId: source.id,
      fileBuffer: csvBuffer([csvRow({ cardNumber: "1/1", productId: "card:x|1/1|Holo|null|null|null|nm" })]),
    })
    expect(result).toEqual({ kind: "SOURCE_ARCHIVED", inventorySourceId: source.id })
    const [{ count }] = (await pgConnection.raw(
      `select count(*)::int as count from trading_card_inventory_snapshot where inventory_source_id = ?`, [source.id],
    )).rows
    expect(count).toBe(0)
  }, 60000)

  it("returns VALIDATION_FAILED for a CSV missing a required header, with no snapshot ever created", async () => {
    const source = await createSource()
    const result = await importPulseCsvSnapshot(container, {
      ...baseInput, inventorySourceId: source.id,
      fileBuffer: Buffer.from("Product Name,Set\nCrobat,Test Set", "utf-8"),
    })
    expect(result.kind).toBe("VALIDATION_FAILED")
    const [{ count }] = (await pgConnection.raw(
      `select count(*)::int as count from trading_card_inventory_snapshot where inventory_source_id = ?`, [source.id],
    )).rows
    expect(count).toBe(0)
  }, 60000)

  it("moves a snapshot with only invalid rows to FAILED and never reaches reconciliation or holdings", async () => {
    const source = await createSource()
    const before = (await pgConnection.raw(`select count(*)::int as count from trading_card_inventory_holding`)).rows[0].count
    const result = await importPulseCsvSnapshot(container, {
      ...baseInput, inventorySourceId: source.id,
      fileBuffer: csvBuffer([csvRow({ cardNumber: "1/1", productId: "card:x|1/1|Holo|null|null|null|nm", quantity: "not-a-number" })]),
    })
    expect(result).toMatchObject({ kind: "NO_USABLE_ROWS", snapshotStatus: "FAILED" })
    const after = (await pgConnection.raw(`select count(*)::int as count from trading_card_inventory_holding`)).rows[0].count
    expect(after).toBe(before)
  }, 60000)

  it("excludes invalid rows from reconciliation while still reconciling the valid rows in the same upload", async () => {
    const source = await createSource()
    const cardNumber = `077/${suffix().slice(0, 3)}`
    const { variant } = await createMatchableVariant(cardNumber)
    const setCode = (await pgConnection.raw(
      `select cs.provider_set_code from trading_card_set cs
       inner join trading_card tc on tc.card_set_id = cs.id
       inner join trading_card_variant tv on tv.trading_card_id = tc.id
       where tv.id = ?`, [variant.id],
    )).rows[0].provider_set_code as string
    const validProductId = `card:${setCode}|${cardNumber}|Holo|null|null|null|nm`
    const result = await importPulseCsvSnapshot(container, {
      ...baseInput, inventorySourceId: source.id,
      fileBuffer: csvBuffer([
        csvRow({ cardNumber, productId: validProductId }),
        csvRow({ cardNumber: "999/999", productId: "card:invalidset|999/999|Holo|null|null|null|nm", quantity: "not-a-number" }),
      ]),
    })
    expect(result.kind).toBe("IMPORTED")
    if (result.kind !== "IMPORTED") throw new Error("expected IMPORTED")
    const proposals = await inventory.listInventoryProposals({ inventory_snapshot_id: result.snapshotId })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].provider_reference).toBe(validProductId)
  }, 60000)
})
