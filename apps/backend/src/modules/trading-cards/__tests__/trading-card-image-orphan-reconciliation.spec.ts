import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import sharp from "sharp"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260715120000 } from "../migrations/Migration20260715120000"
import { FakeR2ImageStorageClient } from "../__fixtures__/fake-r2-client"
import { MANAGED_STAGING_PREFIX, MANAGED_FINAL_PREFIX } from "../images/managed-prefixes"
import { normaliseCardNumberComparisonForm } from "../identity/card-number"

/**
 * Focuses on what genuinely needs a real database and the real service
 * method: live-row reference checks (PENDING/READY/ARCHIVED retention) and
 * the advisory-lock behaviour as wired through
 * `reconcileOrphanedImageObjects`. The pure list/check/delete loop itself
 * (pagination, the max-object bound, the two-check race guard, delete
 * failure handling, idempotent repeats, missing-object deletion) is
 * exhaustively covered against a fake R2 client with no database at all in
 * `images/__tests__/orphan-reconciliation.unit.spec.ts`, and the lock
 * primitive itself (independent prefixes, overlapping-run skip, release
 * after failure) is covered directly in
 * `orphan-reconciliation-lock.integration.spec.ts` — this file does not
 * repeat either.
 */

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`
const databaseUrl = process.env.DATABASE_URL as string

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: databaseUrl })
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[TRADING_CARDS_MODULE]

  // See the identical comment in trading-cards-module.spec.ts: this
  // migration's up() must be re-applied before any card-image test runs, in
  // case an earlier-run migration spec in the same Jest worker undid its
  // audit check widening. Idempotent.
  const migration = new Migration20260715120000(undefined as never, undefined as never)
  await migration.up()
  for (const query of migration.getQueries()) await pgConnection.raw(String(query))
  migration.reset()
}, 60000)

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

async function createVariant() {
  const setId = suffix()
  const set = await service.createCardSets({
    game: "POKEMON", language: "EN", display_name: `Orphan Reconciliation Test Set ${setId}`, provider_set_code: `set_${setId}`,
  })
  const cardId = suffix()
  const card = await service.createTradingCards({
    card_set_id: set.id, name: `Orphan Reconciliation Test Card ${cardId}`, search_name: `orphan reconciliation test card ${cardId}`,
    card_number: "088/150", card_number_normalised: normaliseCardNumberComparisonForm("088/150"), origin: "PULSE",
  })
  const variantId = suffix()
  const variant = await service.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
    finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
    special_treatment_confirmed: true, sku: `POKEMON-EN-ORPHANRECON-088_150-${variantId.toUpperCase()}`,
    origin: "PULSE",
  })
  return variant
}

async function buildJpegFixture(): Promise<Buffer> {
  return sharp({ create: { width: 6, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer()
}

async function createPendingImage(r2Client: FakeR2ImageStorageClient, variantId: string) {
  const { image } = await service.beginCardImageUpload({
    tradingCardVariantId: variantId, uploadedBy: "admin_test", originalFilename: "card.jpg",
    declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576, actor: "admin_test", source: "MANUAL", r2Client,
  })
  return image
}

async function createReadyImage(r2Client: FakeR2ImageStorageClient, variantId: string) {
  const pending = await createPendingImage(r2Client, variantId)
  r2Client.seedObject(pending.staging_object_key, await buildJpegFixture())
  return service.confirmPendingCardImage({ id: pending.id, actor: "admin_test", source: "MANUAL", r2Client })
}

async function createArchivedImage(r2Client: FakeR2ImageStorageClient, variantId: string) {
  const ready = await createReadyImage(r2Client, variantId)
  return service.archiveCardImage({ id: ready.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" })
}

/** Backdates an already-stored object's `lastModified` past the grace period without touching its bytes. */
async function age(r2Client: FakeR2ImageStorageClient, key: string, minutesAgo: number) {
  const { bytes } = await r2Client.getObject(key)
  r2Client.seedObject(key, bytes, new Date(Date.now() - minutesAgo * 60_000))
}

function graceCutoff(minutes = 30) {
  return new Date(Date.now() - minutes * 60_000)
}

describe("reconcileOrphanedImageObjects", () => {
  it("deletes an old untracked staging object in live mode", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}nobody/${suffix()}/orphan.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * 60 * 60_000))

    const counts = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 100, databaseUrl,
    })

    expect(counts.deleted).toBeGreaterThanOrEqual(1)
    expect(r2Client.hasObject(key)).toBe(false)
  })

  it("counts an old untracked object as wouldDelete in dry-run and never deletes it", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_FINAL_PREFIX}nobody/${suffix()}/orphan.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * 60 * 60_000))

    const counts = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_FINAL_PREFIX, graceCutoff: graceCutoff(), dryRun: true,
      maxObjectsPerRun: 100, databaseUrl,
    })

    expect(counts.wouldDelete).toBeGreaterThanOrEqual(1)
    expect(counts.deleted).toBe(0)
    expect(r2Client.hasObject(key)).toBe(true)
  })

  it("retains an object referenced by a live PENDING row's staging_object_key", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const variant = await createVariant()
    const pending = await createPendingImage(r2Client, variant.id)
    // Simulates "the browser already PUT the file, but nobody confirmed it
    // yet" — beginCardImageUpload itself never writes bytes to R2.
    r2Client.seedObject(pending.staging_object_key, await buildJpegFixture())
    await age(r2Client, pending.staging_object_key, 60)

    const counts = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })

    expect(counts.retained).toBeGreaterThanOrEqual(1)
    expect(r2Client.hasObject(pending.staging_object_key)).toBe(true)
  })

  it("retains an object referenced by a live READY row's final_object_key", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const variant = await createVariant()
    const ready = await createReadyImage(r2Client, variant.id)
    await age(r2Client, ready.final_object_key, 60)

    const counts = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_FINAL_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })

    expect(counts.retained).toBeGreaterThanOrEqual(1)
    expect(r2Client.hasObject(ready.final_object_key)).toBe(true)
  })

  it("retains an object referenced by a live ARCHIVED row's final_object_key", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const variant = await createVariant()
    const archived = await createArchivedImage(r2Client, variant.id)
    await age(r2Client, archived.final_object_key, 60)

    const counts = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_FINAL_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })

    expect(counts.retained).toBeGreaterThanOrEqual(1)
    expect(r2Client.hasObject(archived.final_object_key)).toBe(true)
  })

  it("retains an object inside the grace period even though it is unreferenced", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}nobody/${suffix()}/fresh.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date())

    const counts = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })

    expect(r2Client.hasObject(key)).toBe(true)
    expect(counts.deleted).toBe(0)
  })

  it("independent staging and final locks let both prefixes run at the same time", async () => {
    const stagingClient = new FakeR2ImageStorageClient()
    const finalClient = new FakeR2ImageStorageClient()
    const stagingKey = `${MANAGED_STAGING_PREFIX}nobody/${suffix()}/orphan.jpg`
    const finalKey = `${MANAGED_FINAL_PREFIX}nobody/${suffix()}/orphan.jpg`
    stagingClient.seedObject(stagingKey, Buffer.from("x"), new Date(Date.now() - 2 * 60 * 60_000))
    finalClient.seedObject(finalKey, Buffer.from("x"), new Date(Date.now() - 2 * 60 * 60_000))

    const [stagingCounts, finalCounts] = await Promise.all([
      service.reconcileOrphanedImageObjects({
        r2Client: stagingClient, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
        maxObjectsPerRun: 500, databaseUrl,
      }),
      service.reconcileOrphanedImageObjects({
        r2Client: finalClient, prefix: MANAGED_FINAL_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
        maxObjectsPerRun: 500, databaseUrl,
      }),
    ])

    expect(stagingClient.hasObject(stagingKey)).toBe(false)
    expect(finalClient.hasObject(finalKey)).toBe(false)
    expect(stagingCounts.pagesProcessed).toBeGreaterThanOrEqual(1)
    expect(finalCounts.pagesProcessed).toBeGreaterThanOrEqual(1)
  })

  it("a second overlapping run for the same prefix is skipped and returns zeroed counts", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}nobody/${suffix()}/contested.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * 60 * 60_000))

    let releaseFirstListing!: () => void
    const firstListingBlocked = new Promise<void>((resolve) => { releaseFirstListing = resolve })
    let firstListingStarted!: () => void
    const firstListingStartedPromise = new Promise<void>((resolve) => { firstListingStarted = resolve })

    const realListObjects = r2Client.listObjects.bind(r2Client)
    let firstCallSeen = false
    jest.spyOn(r2Client, "listObjects").mockImplementation(async (input) => {
      if (!firstCallSeen) {
        firstCallSeen = true
        firstListingStarted()
        await firstListingBlocked
      }
      return realListObjects(input)
    })

    const firstRun = service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })

    await firstListingStartedPromise
    const secondRun = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })

    expect(secondRun).toEqual({
      scanned: 0, retained: 0, wouldDelete: 0, deleted: 0, errors: 0, pagesProcessed: 0, limitReached: false,
    })

    releaseFirstListing()
    const firstCounts = await firstRun
    expect(firstCounts.deleted).toBeGreaterThanOrEqual(1)
  })

  it("the lock is released after a thrown failure, so a later run for the same prefix can still proceed", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}nobody/${suffix()}/retry-after-failure.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * 60 * 60_000))
    r2Client.failNextListWith(new Error("simulated listObjects failure"))

    await expect(service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })).rejects.toThrow()

    const counts = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })

    expect(counts.deleted).toBeGreaterThanOrEqual(1)
    expect(r2Client.hasObject(key)).toBe(false)
  })

  it("running the same scan twice is idempotent — the second run finds nothing left for that object", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    const key = `${MANAGED_STAGING_PREFIX}nobody/${suffix()}/once.jpg`
    r2Client.seedObject(key, Buffer.from("x"), new Date(Date.now() - 2 * 60 * 60_000))

    const first = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })
    expect(first.deleted).toBeGreaterThanOrEqual(1)
    expect(r2Client.hasObject(key)).toBe(false)

    const second = await service.reconcileOrphanedImageObjects({
      r2Client, prefix: MANAGED_STAGING_PREFIX, graceCutoff: graceCutoff(), dryRun: false,
      maxObjectsPerRun: 500, databaseUrl,
    })
    expect(r2Client.hasObject(key)).toBe(false)
    expect(second.errors).toBe(0)
  })
})
