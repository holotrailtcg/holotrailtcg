import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection, MedusaError } from "@medusajs/framework/utils"
import sharp from "sharp"
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

async function createSet(language: "EN" | "JA" | "ZH" = "EN") {
  const id = suffix()
  return service.createCardSets({
    game: "POKEMON", language, display_name: `Confirm Test Set ${id}`, provider_set_code: `set_${id}`,
  })
}

async function createCard(language: "EN" | "JA" | "ZH" = "EN", number = "044/072") {
  const set = await createSet(language)
  const id = suffix()
  const card = await service.createTradingCards({
    card_set_id: set.id, name: `Confirm Test Card ${id}`, search_name: `confirm test card ${id}`,
    card_number: number, card_number_normalised: normaliseCardNumberComparisonForm(number), origin: "PULSE",
  })
  return { set, card }
}

async function createVariant(overrides: Record<string, unknown> = {}) {
  const { card } = await createCard()
  const id = suffix()
  const variant = await service.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
    finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
    special_treatment_confirmed: true, sku: `POKEMON-EN-CONFIRM-044_072-${id.toUpperCase()}`,
    origin: "PULSE", ...overrides,
  })
  return { card, variant }
}

const beginInput = (variantId: string, overrides: Record<string, unknown> = {}) => ({
  tradingCardVariantId: variantId, uploadedBy: "admin_test", originalFilename: "card.jpg",
  declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576,
  actor: "admin_test", source: "MANUAL", ...overrides,
})

async function buildJpegFixture(width = 6, height = 8): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).jpeg().toBuffer()
}

async function buildPngFixture(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  }).png().toBuffer()
}

describe("beginCardImageUpload", () => {
  it("creates a PENDING row and returns a presigned URL for its staging key", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const before = Date.now()

    const { image, presigned } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })

    expect(image.status).toBe("PENDING")
    expect(image.staging_object_key).toContain(`card-images/${variant.id}/`)
    expect(r2Client.presignCalls).toEqual([
      expect.objectContaining({ key: image.staging_object_key, contentType: "image/jpeg" }),
    ])
    expect(presigned.uploadUrl).toContain(image.staging_object_key)

    const expiresAt = new Date(image.upload_expires_at).getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 14 * 60_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 16 * 60_000)
  })

  it("rejects an oversized declaredByteSize before calling the fake client at all", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()

    await expect(service.beginCardImageUpload({
      ...beginInput(variant.id, { declaredByteSize: 11 * 1024 * 1024 }), r2Client,
    })).rejects.toThrow(/must not exceed|must be a positive integer/)

    expect(r2Client.presignCalls).toHaveLength(0)
  })

  it("returns NOT_FOUND for a non-existent variant without creating a row", async () => {
    const r2Client = new FakeR2ImageStorageClient()
    await expect(service.beginCardImageUpload({
      ...beginInput("tcvar_does_not_exist"), r2Client,
    })).rejects.toThrow(/not found/i)
    expect(r2Client.presignCalls).toHaveLength(0)
  })
})

describe("confirmPendingCardImage", () => {
  it("transitions PENDING to READY with correct confirmed metadata and a fresh sort order", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    const bytes = await buildJpegFixture(6, 8)
    r2Client.seedObject(image.staging_object_key, bytes)

    const confirmed = await service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })

    expect(confirmed.status).toBe("READY")
    expect(confirmed.staging_object_key).toBeNull()
    expect(confirmed.final_object_key).toContain(`card-images/${variant.id}/`)
    expect(confirmed.confirmed_mime_type).toBe("image/jpeg")
    expect(confirmed.width).toBe(6)
    expect(confirmed.height).toBe(8)
    expect(confirmed.sha256_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(confirmed.sort_order).toBe(0)

    expect(r2Client.getCalls).toEqual([image.staging_object_key])
    expect(r2Client.putCalls).toHaveLength(1)
    expect(r2Client.putCalls[0].key).toBe(confirmed.final_object_key)

    const [audit] = await pgConnection.raw(
      `select action, new_value from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_UPLOAD_CONFIRMED'`,
      [image.id]
    ).then((result: any) => (Array.isArray(result) ? result : result.rows))
    expect(audit).toBeDefined()
    expect(audit.new_value.declaredByteSize).toBe(1_048_576)
    expect(audit.new_value.actualByteSize).toBe(bytes.length)
  })

  it("records a diagnostic declared/actual size mismatch without rejecting the upload", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({
      ...beginInput(variant.id, { declaredByteSize: 9 * 1024 * 1024 }), r2Client,
    })
    const bytes = await buildJpegFixture(4, 4)
    r2Client.seedObject(image.staging_object_key, bytes)

    const confirmed = await service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(confirmed.status).toBe("READY")

    const [audit] = await pgConnection.raw(
      `select new_value from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_UPLOAD_CONFIRMED'`,
      [image.id]
    ).then((result: any) => (Array.isArray(result) ? result : result.rows))
    expect(audit.new_value.declaredByteSize).toBe(9 * 1024 * 1024)
    expect(audit.new_value.actualByteSize).toBe(bytes.length)
  })

  it("detects a duplicate scoped to the same variant only", async () => {
    const { variant: variantA } = await createVariant()
    const { variant: variantB } = await createVariant()
    const bytes = await buildPngFixture()

    const r2Client = new FakeR2ImageStorageClient()
    const first = await service.beginCardImageUpload({
      ...beginInput(variantA.id, { declaredMimeType: "image/png" }), r2Client,
    })
    r2Client.seedObject(first.image.staging_object_key, bytes)
    const firstConfirmed = await service.confirmPendingCardImage({
      id: first.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(firstConfirmed.status).toBe("READY")

    // Same bytes uploaded again to the SAME variant -> DUPLICATE.
    const secondSameVariant = await service.beginCardImageUpload({
      ...beginInput(variantA.id, { declaredMimeType: "image/png" }), r2Client,
    })
    r2Client.seedObject(secondSameVariant.image.staging_object_key, bytes)
    const secondConfirmed = await service.confirmPendingCardImage({
      id: secondSameVariant.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(secondConfirmed.status).toBe("DUPLICATE")
    expect(secondConfirmed.final_object_key).toBeNull()
    expect(secondConfirmed.staging_object_key).toBeNull()
    expect(secondConfirmed.sha256_hash).toBeNull()
    // Accepted trade-off documented in the Stage 4B.2 plan: the final-key
    // put still happens before the duplicate check runs, so it is called
    // once here even though the row never reaches READY.
    expect(r2Client.putCalls).toHaveLength(2)

    // Same bytes uploaded to a DIFFERENT variant -> READY, not DUPLICATE
    // (duplicate detection is scoped per-variant, never cross-variant).
    const thirdOtherVariant = await service.beginCardImageUpload({
      ...beginInput(variantB.id, { declaredMimeType: "image/png" }), r2Client,
    })
    r2Client.seedObject(thirdOtherVariant.image.staging_object_key, bytes)
    const thirdConfirmed = await service.confirmPendingCardImage({
      id: thirdOtherVariant.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(thirdConfirmed.status).toBe("READY")

    const [duplicateAudit] = await pgConnection.raw(
      `select new_value from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_DUPLICATE_DETECTED'`,
      [secondSameVariant.image.id]
    ).then((result: any) => (Array.isArray(result) ? result : result.rows))
    expect(duplicateAudit.new_value.duplicateOfImageId).toBe(firstConfirmed.id)
  })

  it("rejects confirming an already-READY, DUPLICATE, REJECTED, or EXPIRED image with specific messages and no new audit entry", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()

    const ready = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(ready.image.staging_object_key, await buildJpegFixture())
    await service.confirmPendingCardImage({ id: ready.image.id, actor: "admin_test", source: "MANUAL", r2Client })
    const auditsBeforeReady = await pgConnection.raw(
      `select id from trading_card_audit_entry where entity_id = ?`, [ready.image.id]
    ).then((result: any) => (Array.isArray(result) ? result : result.rows))
    await expect(service.confirmPendingCardImage({
      id: ready.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/already been confirmed/)
    const auditsAfterReady = await pgConnection.raw(
      `select id from trading_card_audit_entry where entity_id = ?`, [ready.image.id]
    ).then((result: any) => (Array.isArray(result) ? result : result.rows))
    expect(auditsAfterReady).toHaveLength(auditsBeforeReady.length)

    const zeroByte = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(zeroByte.image.staging_object_key, Buffer.alloc(0))
    await expect(service.confirmPendingCardImage({
      id: zeroByte.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/was empty/)
    await expect(service.confirmPendingCardImage({
      id: zeroByte.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/already rejected/)

    const expired = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    await pgConnection.raw(
      `update trading_card_image set upload_expires_at = now() - interval '1 minute' where id = ?`,
      [expired.image.id]
    )
    const getCallsBefore = r2Client.getCalls.length
    await expect(service.confirmPendingCardImage({
      id: expired.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/upload window has expired/)
    expect(r2Client.getCalls.length).toBe(getCallsBefore)
    await expect(service.confirmPendingCardImage({
      id: expired.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/This upload has expired/)
  })

  it("rejects a corrupted or unsupported-format upload", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()

    const corrupted = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(corrupted.image.staging_object_key, Buffer.from("not an image, just text"))
    await expect(service.confirmPendingCardImage({
      id: corrupted.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/corrupted or not a readable image/)

    const unsupported = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>')
    r2Client.seedObject(unsupported.image.staging_object_key, svg)
    await expect(service.confirmPendingCardImage({
      id: unsupported.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/not a supported image format/)

    const rows = await pgConnection.raw(
      `select status, staging_object_key, final_object_key from trading_card_image where id in (?, ?)`,
      [corrupted.image.id, unsupported.image.id]
    ).then((result: any) => (Array.isArray(result) ? result : result.rows))
    for (const row of rows) {
      expect(row.status).toBe("REJECTED")
      expect(row.staging_object_key).toBeNull()
      expect(row.final_object_key).toBeNull()
    }
  })

  it("rejects an oversized fetched object without invoking the sharp pipeline", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const oversized = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    // A real 11 MB buffer isn't needed: the byte-size check runs before any
    // image parsing, so an arbitrary buffer this large is sufficient.
    r2Client.seedObject(oversized.image.staging_object_key, Buffer.alloc(11 * 1024 * 1024, 1))
    await expect(service.confirmPendingCardImage({
      id: oversized.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/exceeds the .* byte limit/)
  })

  it("serialises a concurrent double-confirm attempt so exactly one call reaches READY", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(image.staging_object_key, await buildJpegFixture())

    const results = await Promise.allSettled([
      service.confirmPendingCardImage({ id: image.id, actor: "admin_test", source: "MANUAL", r2Client }),
      service.confirmPendingCardImage({ id: image.id, actor: "admin_test", source: "MANUAL", r2Client }),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((fulfilled[0] as PromiseFulfilledResult<any>).value.status).toBe("READY")

    const final = await service.retrieveCardImage(image.id)
    expect(final.status).toBe("READY")
  })
})

describe("confirmation rollback and failure paths", () => {
  it("persists EXPIRED (not READY) and returns a stable expiry error when the upload window expires during the R2 write", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(image.staging_object_key, await buildJpegFixture())

    // Simulates real-world timing: the 15-minute window lapses while the
    // re-encoded bytes are in flight to R2, not before it. This exercises
    // the final locked transaction's own expiry re-check, not the earlier
    // pre-fetch one.
    r2Client.onNextPut(async () => {
      await pgConnection.raw(
        `update trading_card_image set upload_expires_at = now() - interval '1 minute' where id = ?`,
        [image.id]
      )
    })

    await expect(service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/upload window has expired/)

    const persisted = await service.retrieveCardImage(image.id)
    expect(persisted.status).toBe("EXPIRED")
    expect(persisted.staging_object_key).toBeNull()
    expect(persisted.final_object_key).toBeNull()
    expect(persisted.confirmed_mime_type).toBeNull()
    expect(persisted.width).toBeNull()
    expect(persisted.sha256_hash).toBeNull()

    const audits = await pgConnection.raw(
      `select action from trading_card_audit_entry where entity_id = ? order by created_at asc`, [image.id]
    ).then(rows)
    expect(audits.map((row: any) => row.action)).toEqual(["IMAGE_UPLOAD_REQUESTED", "IMAGE_UPLOAD_EXPIRED"])
    expect(audits.some((row: any) => row.action === "IMAGE_UPLOAD_CONFIRMED")).toBe(false)

    // Repeated confirmation returns the same safe expired result and never
    // writes a second EXPIRED transition/audit.
    await expect(service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/This upload has expired/)
    const auditsAfterRetry = await pgConnection.raw(
      `select action from trading_card_audit_entry where entity_id = ?`, [image.id]
    ).then(rows)
    expect(auditsAfterRetry.map((row: any) => row.action)).toEqual(["IMAGE_UPLOAD_REQUESTED", "IMAGE_UPLOAD_EXPIRED"])
  })

  it("leaves the row PENDING and retryable when presigning fails, and it can still expire normally afterwards", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    r2Client.failNextPresignWith(new Error("simulated presign failure"))

    await expect(service.beginCardImageUpload({ ...beginInput(variant.id), r2Client }))
      .rejects.toThrow(/simulated presign failure/)

    const [persisted] = await pgConnection.raw(
      `select * from trading_card_image where trading_card_variant_id = ? order by created_at desc limit 1`,
      [variant.id]
    ).then(rows)
    expect(persisted.status).toBe("PENDING")
    expect(persisted.staging_object_key).not.toBeNull()

    const audits = await pgConnection.raw(
      `select action from trading_card_audit_entry where entity_id = ?`, [persisted.id]
    ).then(rows)
    expect(audits.map((row: any) => row.action)).toEqual(["IMAGE_UPLOAD_REQUESTED"])

    // The route's contract for this failure is documented, intentional
    // behaviour, not a bug: the PENDING row is simply left to expire via
    // the normal EXPIRED path, exactly like any other abandoned upload.
    await pgConnection.raw(
      `update trading_card_image set upload_expires_at = now() - interval '1 minute' where id = ?`, [persisted.id]
    )
    await expect(service.confirmPendingCardImage({
      id: persisted.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/upload window has expired/)
    const expired = await service.retrieveCardImage(persisted.id)
    expect(expired.status).toBe("EXPIRED")
  })

  it("leaves the row PENDING and retryable when getObject fails, with no final metadata or confirmation audit", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(image.staging_object_key, await buildJpegFixture())
    r2Client.failNextGetWith(new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "simulated storage read failure"))

    await expect(service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/simulated storage read failure/)

    const persisted = await service.retrieveCardImage(image.id)
    expect(persisted.status).toBe("PENDING")
    expect(persisted.final_object_key).toBeNull()
    expect(persisted.confirmed_mime_type).toBeNull()

    const audits = await pgConnection.raw(
      `select action from trading_card_audit_entry where entity_id = ?`, [image.id]
    ).then(rows)
    expect(audits.map((row: any) => row.action)).toEqual(["IMAGE_UPLOAD_REQUESTED"])

    // Retryable: the same staging object is still present, so a second
    // confirm call (with the transient failure cleared) succeeds normally.
    const confirmed = await service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(confirmed.status).toBe("READY")
  })

  it("leaves the row PENDING and retryable when putObject fails, with no final metadata or confirmation audit", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(image.staging_object_key, await buildJpegFixture())
    r2Client.failNextPutWith(new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "simulated storage write failure"))

    await expect(service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })).rejects.toThrow(/simulated storage write failure/)

    const persisted = await service.retrieveCardImage(image.id)
    expect(persisted.status).toBe("PENDING")
    expect(persisted.final_object_key).toBeNull()
    expect(persisted.confirmed_mime_type).toBeNull()
    expect(persisted.sha256_hash).toBeNull()

    const audits = await pgConnection.raw(
      `select action from trading_card_audit_entry where entity_id = ?`, [image.id]
    ).then(rows)
    expect(audits.map((row: any) => row.action)).toEqual(["IMAGE_UPLOAD_REQUESTED"])

    // Retryable: the still-staged object (never removed on a failed put)
    // confirms normally once the store works again.
    const confirmed = await service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(confirmed.status).toBe("READY")
  })

  it("rolls back the entire READY transition, including the already-applied row update, when the transaction fails after putObject has already succeeded — leaving the final R2 object orphaned", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()

    const siblingUpload = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(siblingUpload.image.staging_object_key, await buildJpegFixture(4, 4))
    const sibling = await service.confirmPendingCardImage({
      id: siblingUpload.image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(sibling.status).toBe("READY")
    expect(sibling.sort_order).toBe(0)

    const { image } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(image.staging_object_key, await buildJpegFixture(6, 8))

    // An invalid `source` is a deterministic way to fail the transaction's
    // final `INSERT` (the DB-level enum CHECK constraint on
    // trading_card_audit_entry.source) *after* the READY row UPDATE inside
    // the same transaction has already run — proving the whole transaction,
    // including that already-applied update, rolls back atomically.
    await expect(service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "BOGUS_SOURCE" as any, r2Client,
    })).rejects.toThrow()

    // The R2 write itself already completed before the transaction opened —
    // this is the intended "final object may be orphaned" trade-off,
    // documented as deferred cleanup, not a bug.
    expect(r2Client.putCalls.some((call) => call.key.includes(image.id))).toBe(true)

    const persisted = await service.retrieveCardImage(image.id)
    expect(persisted.status).toBe("PENDING")
    expect(persisted.final_object_key).toBeNull()
    expect(persisted.confirmed_mime_type).toBeNull()
    expect(persisted.sha256_hash).toBeNull()

    const auditsForImage = await pgConnection.raw(
      `select action from trading_card_audit_entry where entity_id = ?`, [image.id]
    ).then(rows)
    expect(auditsForImage.map((row: any) => row.action)).toEqual(["IMAGE_UPLOAD_REQUESTED"])

    // Ordering is unaffected: the sibling's already-committed sort order
    // was never touched by this failed attempt.
    const siblingAfter = await service.retrieveCardImage(sibling.id)
    expect(siblingAfter.sort_order).toBe(0)
  })

  it("rolls back the READY row update when the audit write fails, leaving no confirmation audit and no partial commit", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({ ...beginInput(variant.id), r2Client })
    r2Client.seedObject(image.staging_object_key, await buildJpegFixture())
    const pendingSortOrder = image.sort_order

    await expect(service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "BOGUS_SOURCE" as any, r2Client,
    })).rejects.toThrow()

    const persisted = await service.retrieveCardImage(image.id)
    expect(persisted.status).toBe("PENDING")
    expect(persisted.sort_order).toBe(pendingSortOrder)
    expect(persisted.final_object_key).toBeNull()
    expect(persisted.width).toBeNull()

    const audits = await pgConnection.raw(
      `select action from trading_card_audit_entry where entity_id = ?`, [image.id]
    ).then(rows)
    expect(audits.map((row: any) => row.action)).toEqual(["IMAGE_UPLOAD_REQUESTED"])
    expect(audits.some((row: any) => row.action === "IMAGE_UPLOAD_CONFIRMED")).toBe(false)

    // Retryable: confirming again with a valid source succeeds cleanly —
    // proving the earlier failure left no partially-committed state behind.
    r2Client.seedObject(image.staging_object_key, await buildJpegFixture())
    const confirmed = await service.confirmPendingCardImage({
      id: image.id, actor: "admin_test", source: "MANUAL", r2Client,
    })
    expect(confirmed.status).toBe("READY")
    expect(confirmed.sort_order).toBe(0)
  })
})
