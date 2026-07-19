import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { syncTradingCardProductMedia } from "../sync-product-media"

const R2_ENV = {
  R2_IMAGES_ENABLED: "true",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET_NAME: "test-card-images",
  R2_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  R2_PUBLIC_BASE_URL: "https://images.example.com",
}

describe("syncTradingCardProductMedia", () => {
  const previousEnvironment: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const [key, value] of Object.entries(R2_ENV)) {
      previousEnvironment[key] = process.env[key]
      process.env[key] = value
    }
  })

  afterAll(() => {
    for (const key of Object.keys(R2_ENV)) {
      if (previousEnvironment[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnvironment[key]
    }
  })

  it("replaces product media with every READY card photograph in display order", async () => {
    const updateProducts = jest.fn().mockResolvedValue(undefined)
    const cards = {
      listTradingCardVariants: jest.fn().mockResolvedValue([{ id: "tcvar_1" }, { id: "tcvar_2" }]),
      listCardImagesForVariant: jest.fn()
        .mockResolvedValueOnce([
          { status: "READY", final_object_key: "card-images/tcvar_1/first.jpg" },
          { status: "ARCHIVED", final_object_key: "card-images/tcvar_1/old.jpg" },
        ])
        .mockResolvedValueOnce([{ status: "READY", final_object_key: "card-images/tcvar_2/second.jpg" }]),
      deriveCardImagePublicUrl: jest.fn(({ publicBaseUrl, objectKey }) => `${publicBaseUrl}/${objectKey}`),
    }
    const query = {
      graph: jest.fn().mockResolvedValue({
        data: [{ id: "tcvar_1", trading_card: { id: "tcard_1", product: { id: "prod_1" } } }],
      }),
    }
    const services: Record<string, unknown> = {
      [ContainerRegistrationKeys.QUERY]: query,
      [TRADING_CARDS_MODULE]: cards,
      [Modules.PRODUCT]: { updateProducts },
    }
    const container = { resolve: (key: string) => services[key] }

    await expect(syncTradingCardProductMedia(container as never, "tcvar_1")).resolves.toEqual({
      outcome: "SYNCED", productId: "prod_1", imageCount: 2,
    })
    expect(updateProducts).toHaveBeenCalledWith("prod_1", {
      thumbnail: "https://images.example.com/card-images/tcvar_1/first.jpg",
      images: [
        { url: "https://images.example.com/card-images/tcvar_1/first.jpg" },
        { url: "https://images.example.com/card-images/tcvar_2/second.jpg" },
      ],
    })
  })
})
