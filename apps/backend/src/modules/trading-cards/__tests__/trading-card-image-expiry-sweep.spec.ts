import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260715120000 } from "../migrations/Migration20260715120000"
import { FakeR2ImageStorageClient } from "../__fixtures__/fake-r2-client"
import { normaliseCardNumberComparisonForm } from "../identity/card-number"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
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
    game: "POKEMON", language: "EN", display_name: `Expiry Sweep Test Set ${setId}`, provider_set_code: `set_${setId}`,
  })
  const cardId = suffix()
  const card = await service.createTradingCards({
    card_set_id: set.id, name: `Expiry Sweep Test Card ${cardId}`, search_name: `expiry sweep test card ${cardId}`,
    card_number: "099/150", card_number_normalised: normaliseCardNumberComparisonForm("099/150"), origin: "PULSE",
  })
  const variantId = suffix()
  const variant = await service.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
    finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
    special_treatment_confirmed: true, sku: `POKEMON-EN-EXPSWEEP-099_150-${variantId.toUpperCase()}`,
    origin: "PULSE",
  })
  return { card, variant }
}

async function createPendingUpload(variantId: string) {
  const r2Client = new FakeR2ImageStorageClient()
  const { image } = await service.beginCardImageUpload({
    tradingCardVariantId: variantId, uploadedBy: "admin_test", originalFilename: "card.jpg",
    declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576, actor: "admin_test", source: "MANUAL", r2Client,
  })
  return image
}

async function expireNow(imageId: string) {
  await pgConnection.raw(
    `update trading_card_image set upload_expires_at = now() - interval '1 minute' where id = ?`, [imageId]
  )
}

async function expireMinutesAgo(imageId: string, minutesAgo: number) {
  await pgConnection.raw(
    `update trading_card_image set upload_expires_at = now() - (? || ' minutes')::interval where id = ?`,
    [minutesAgo, imageId]
  )
}

describe("expirePendingCardImages", () => {
  it("transitions an expired PENDING row to EXPIRED, nulls its keys, and writes an IMAGE_UPLOAD_EXPIRED audit entry", async () => {
    const { variant } = await createVariant()
    const image = await createPendingUpload(variant.id)
    await expireNow(image.id)

    const expiredIds = await service.expirePendingCardImages(new Date(), 500)
    expect(expiredIds).toContain(image.id)

    const [saved] = await pgConnection.raw(
      `select * from trading_card_image where id = ?`, [image.id]
    ).then(rows)
    expect(saved.status).toBe("EXPIRED")
    expect(saved.staging_object_key).toBeNull()
    expect(saved.final_object_key).toBeNull()

    const [audit] = await pgConnection.raw(
      `select action, old_value, new_value from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_UPLOAD_EXPIRED'`,
      [image.id]
    ).then(rows)
    expect(audit).toBeDefined()
    expect(audit.old_value).toEqual({ status: "PENDING" })
    expect(audit.new_value).toEqual({ status: "EXPIRED" })
  })

  it("leaves a not-yet-expired PENDING row untouched", async () => {
    const { variant } = await createVariant()
    const image = await createPendingUpload(variant.id)
    // upload_expires_at defaults to ~15 minutes from now — still valid.

    const expiredIds = await service.expirePendingCardImages(new Date(), 500)
    expect(expiredIds).not.toContain(image.id)

    const [saved] = await pgConnection.raw(
      `select status from trading_card_image where id = ?`, [image.id]
    ).then(rows)
    expect(saved.status).toBe("PENDING")
  })

  it("respects the batch size when more expired rows exist than the batch size", async () => {
    const { variant } = await createVariant()
    const images: any[] = []
    for (let i = 0; i < 3; i++) {
      const image = await createPendingUpload(variant.id)
      await expireNow(image.id)
      images.push(image)
    }

    const firstBatch = await service.expirePendingCardImages(new Date(), 2)
    expect(firstBatch).toHaveLength(2)

    const secondBatch = await service.expirePendingCardImages(new Date(), 2)
    expect(secondBatch).toHaveLength(1)

    const thirdBatch = await service.expirePendingCardImages(new Date(), 2)
    expect(thirdBatch).toHaveLength(0)

    for (const image of images) {
      const [saved] = await pgConnection.raw(
        `select status from trading_card_image where id = ?`, [image.id]
      ).then(rows)
      expect(saved.status).toBe("EXPIRED")
    }
  })

  it("running the sweep twice in a row is a no-op the second time", async () => {
    const { variant } = await createVariant()
    const image = await createPendingUpload(variant.id)
    await expireNow(image.id)

    const firstRun = await service.expirePendingCardImages(new Date(), 500)
    expect(firstRun).toContain(image.id)

    const secondRun = await service.expirePendingCardImages(new Date(), 500)
    expect(secondRun).not.toContain(image.id)

    const auditRows = await pgConnection.raw(
      `select id from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_UPLOAD_EXPIRED'`,
      [image.id]
    ).then(rows)
    expect(auditRows).toHaveLength(1)
  })

  it("never double-transitions or double-audits a row when two sweeps race concurrently", async () => {
    const { variant } = await createVariant()
    const images: any[] = []
    for (let i = 0; i < 6; i++) {
      const image = await createPendingUpload(variant.id)
      await expireNow(image.id)
      images.push(image)
    }

    // `expirePendingCardImages` itself only ever selects one bounded batch
    // (`limit batchSize ... for update skip locked`); draining a backlog
    // larger than the batch size is the caller's job, exactly as
    // `card-image-expiry-sweep.ts` does with its own do/while loop. Mirroring
    // that loop here — with a batch size smaller than the candidate count —
    // is what forces each "sweep" to make several round trips, so the two
    // concurrent sweeps are still mid-flight (each holding row locks on
    // different rows) at the same time. `FOR UPDATE SKIP LOCKED` is what
    // keeps them from ever selecting the same row in that overlap, which is
    // exactly the interleaving a mocked database could never reproduce.
    const batchSize = 2
    async function drainSweep(): Promise<string[]> {
      const expired: string[] = []
      let batch: string[]
      do {
        batch = await service.expirePendingCardImages(new Date(), batchSize)
        expired.push(...batch)
      } while (batch.length === batchSize)
      return expired
    }

    const [firstIds, secondIds] = await Promise.all([drainSweep(), drainSweep()])

    const firstSet = new Set(firstIds)
    const secondSet = new Set(secondIds)
    const overlap = [...firstSet].filter((id) => secondSet.has(id))
    expect(overlap).toEqual([])

    const combined = new Set([...firstIds, ...secondIds])
    expect(combined.size).toBe(images.length)
    for (const image of images) {
      expect(combined.has(image.id)).toBe(true)
    }

    for (const image of images) {
      const [saved] = await pgConnection.raw(
        `select status, staging_object_key, final_object_key from trading_card_image where id = ?`,
        [image.id]
      ).then(rows)
      expect(saved.status).toBe("EXPIRED")
      expect(saved.staging_object_key).toBeNull()
      expect(saved.final_object_key).toBeNull()

      const auditRows = await pgConnection.raw(
        `select id from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_UPLOAD_EXPIRED'`,
        [image.id]
      ).then(rows)
      expect(auditRows).toHaveLength(1)
    }
  })

  it("skips a row a concurrent transaction holds locked and picks the next-eligible row instead of waiting on it", async () => {
    // This is the one test in the suite that can tell `for update skip
    // locked` apart from plain `for update`: both eventually reach the same
    // final state, so a `Promise.all` + final-assertions test (see above)
    // can't distinguish "skipped immediately" from "waited, then ran". Here
    // a second, independent connection holds a real row lock on image A
    // open for the whole assertion, so a sweep using plain `for update`
    // would block on that lock and lose the race against `sweepTimeoutMs`
    // below, while `skip locked` returns immediately with image B instead.
    const { variant } = await createVariant()
    const imageA = await createPendingUpload(variant.id)
    const imageB = await createPendingUpload(variant.id)
    // Deterministic expiry ordering: A expires before B, so `order by
    // upload_expires_at asc` would pick A first if it weren't locked.
    await expireMinutesAgo(imageA.id, 2)
    await expireMinutesAgo(imageB.id, 1)

    const lockHolderConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
    let releaseLock!: () => void
    const releaseLockRequested = new Promise<void>((resolve) => { releaseLock = resolve })
    let lockAcquired!: () => void
    const lockAcquiredPromise = new Promise<void>((resolve) => { lockAcquired = resolve })

    const lockHolderTransaction = lockHolderConnection.transaction(async (trx) => {
      await trx.raw(`select id from trading_card_image where id = ? for update`, [imageA.id])
      lockAcquired()
      await releaseLockRequested
    })

    try {
      await lockAcquiredPromise

      const sweepPromise = service.expirePendingCardImages(new Date(), 1)
      const sweepTimeoutMs = 3000
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`expirePendingCardImages did not resolve within ${sweepTimeoutMs}ms — it is likely blocked waiting on image A's held lock instead of skipping it`)),
          sweepTimeoutMs
        )
      })

      const sweptIds = await Promise.race([sweepPromise, timeout])
      expect(sweptIds).toEqual([imageB.id])

      const [savedA] = await pgConnection.raw(
        `select status from trading_card_image where id = ?`, [imageA.id]
      ).then(rows)
      expect(savedA.status).toBe("PENDING")

      const [savedB] = await pgConnection.raw(
        `select status from trading_card_image where id = ?`, [imageB.id]
      ).then(rows)
      expect(savedB.status).toBe("EXPIRED")

      const auditRowsB = await pgConnection.raw(
        `select id from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_UPLOAD_EXPIRED'`,
        [imageB.id]
      ).then(rows)
      expect(auditRowsB).toHaveLength(1)
    } finally {
      releaseLock()
      await lockHolderTransaction
      await (lockHolderConnection as any)?.context?.destroy()
      await lockHolderConnection?.destroy()
    }

    // With image A's lock released, a later sweep must still pick it up.
    const secondSweptIds = await service.expirePendingCardImages(new Date(), 500)
    expect(secondSweptIds).toContain(imageA.id)

    const [savedA] = await pgConnection.raw(
      `select status from trading_card_image where id = ?`, [imageA.id]
    ).then(rows)
    expect(savedA.status).toBe("EXPIRED")

    const auditRowsA = await pgConnection.raw(
      `select id from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_UPLOAD_EXPIRED'`,
      [imageA.id]
    ).then(rows)
    expect(auditRowsA).toHaveLength(1)
  })
})
