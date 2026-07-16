import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import sharp from "sharp"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260715120000 } from "../migrations/Migration20260715120000"
import type { FetchedObject, PresignedUpload, R2ImageStorageClient } from "../images/r2-client"

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
    game: "POKEMON", language: "EN", display_name: `Focal Test Set ${setId}`, provider_set_code: `set_${setId}`,
  })
  const cardId = suffix()
  const card = await service.createTradingCards({
    card_set_id: set.id, name: `Focal Test Card ${cardId}`, search_name: `focal test card ${cardId}`,
    card_number: "010/050", card_number_normalised: "010/050", origin: "PULSE",
  })
  const variantId = suffix()
  const variant = await service.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
    finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
    special_treatment_confirmed: true, sku: `POKEMON-EN-FOCAL-010_050-${variantId.toUpperCase()}`,
    origin: "PULSE",
  })
  return { card, variant }
}

/** Minimal fake R2 client, only enough to drive a PENDING image to READY. */
class FakeR2ImageStorageClient implements R2ImageStorageClient {
  private objects = new Map<string, Buffer>()

  seedObject(key: string, bytes: Buffer) {
    this.objects.set(key, bytes)
  }

  async createPresignedPutUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedUpload> {
    return {
      uploadUrl: `https://fake-r2.invalid/${input.key}`,
      requiredHeaders: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    }
  }

  async getObject(key: string): Promise<FetchedObject> {
    const bytes = this.objects.get(key)
    if (!bytes) throw new Error("fake object not found")
    return { bytes, byteSize: bytes.length, contentType: null }
  }

  async putObject(input: { key: string; body: Buffer }): Promise<void> {
    this.objects.set(input.key, input.body)
  }
}

async function createReadyImage() {
  const { variant } = await createVariant()
  const r2Client = new FakeR2ImageStorageClient()
  const { image } = await service.beginCardImageUpload({
    tradingCardVariantId: variant.id, uploadedBy: "admin_test", originalFilename: "card.jpg",
    declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576, actor: "admin_test", source: "MANUAL", r2Client,
  })
  const bytes = await sharp({
    create: { width: 6, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).jpeg().toBuffer()
  r2Client.seedObject(image.staging_object_key, bytes)
  const confirmed = await service.confirmPendingCardImage({ id: image.id, actor: "admin_test", source: "MANUAL", r2Client })
  return { variant, image: confirmed }
}

describe("updateCardImageFocalPoint", () => {
  it("rejects out-of-bounds focal values", async () => {
    const { image } = await createReadyImage()
    await expect(service.updateCardImageFocalPoint({
      id: image.id, focalX: 1.5, focalY: 0.5, actor: "admin_test", source: "MANUAL",
    })).rejects.toThrow(/between 0 and 1/)
    await expect(service.updateCardImageFocalPoint({
      id: image.id, focalX: 0.5, focalY: -0.1, actor: "admin_test", source: "MANUAL",
    })).rejects.toThrow(/between 0 and 1/)
  })

  it("rejects changing focal point on a non-ready image", async () => {
    const { variant } = await createVariant()
    const r2Client = new FakeR2ImageStorageClient()
    const { image } = await service.beginCardImageUpload({
      tradingCardVariantId: variant.id, uploadedBy: "admin_test", originalFilename: "card.jpg",
      declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576, actor: "admin_test", source: "MANUAL", r2Client,
    })

    await expect(service.updateCardImageFocalPoint({
      id: image.id, focalX: 0.2, focalY: 0.8, actor: "admin_test", source: "MANUAL",
    })).rejects.toThrow(/only a ready image/i)
  })

  it("updates focal_x/focal_y on a ready image and writes an IMAGE_FOCAL_CHANGED audit entry", async () => {
    const { image } = await createReadyImage()

    const saved = await service.updateCardImageFocalPoint({
      id: image.id, focalX: 0.2, focalY: 0.8, actor: "admin_test", source: "MANUAL",
    })

    expect(Number(saved.focal_x)).toBeCloseTo(0.2)
    expect(Number(saved.focal_y)).toBeCloseTo(0.8)

    const [audit] = rows(await pgConnection.raw(
      `select action, old_value, new_value from trading_card_audit_entry where entity_id = ? and action = 'IMAGE_FOCAL_CHANGED'`,
      [image.id]
    ))
    expect(audit).toBeDefined()
    expect(audit.old_value).toEqual({ focalX: 0.5, focalY: 0.5 })
    expect(audit.new_value).toEqual({ focalX: 0.2, focalY: 0.8 })
  })
})
