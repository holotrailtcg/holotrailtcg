import { listThumbnailsForVariants } from "../admin-image-review"

interface FakeRow {
  trading_card_variant_id?: string
  final_object_key?: string
  snapshot?: unknown
  id?: string
  trading_card_id?: string
}

function fakeExecutor(responses: {
  variants: FakeRow[]
  photos: FakeRow[]
  tcgdex: FakeRow[]
}) {
  const execute = jest.fn(async (query: string) => {
    if (query.includes("from trading_card_variant where id in")) return responses.variants
    if (query.includes("from trading_card_image")) return responses.photos
    if (query.includes("trading_card_tcgdex_enrichment_proposal")) return responses.tcgdex
    throw new Error(`Unexpected query: ${query}`)
  })
  return { execute } as unknown as Parameters<typeof listThumbnailsForVariants>[0] & { execute: typeof execute }
}

const derivePublicImageUrl = (objectKey: string) => `https://cdn.example/${objectKey}`

describe("listThumbnailsForVariants", () => {
  it("prefers a ready photograph over TCGdex reference art when both exist", async () => {
    const executor = fakeExecutor({
      variants: [{ id: "tcv_1", trading_card_id: "tcard_1" }],
      photos: [{ trading_card_variant_id: "tcv_1", final_object_key: "card-images/tcv_1/photo.jpg" }],
      tcgdex: [],
    })

    const result = await listThumbnailsForVariants(executor, ["tcv_1"], derivePublicImageUrl)

    expect(result.tcv_1).toEqual({
      tradingCardId: "tcard_1", source: "PHOTO", imageUrl: "https://cdn.example/card-images/tcv_1/photo.jpg",
    })
    // No photo found for this variant, so the TCGdex lookup should never run for it.
    expect(executor.execute).not.toHaveBeenCalledWith(expect.stringContaining("trading_card_tcgdex_enrichment_proposal"), expect.anything())
  })

  it("falls back to TCGdex reference art when there is no ready photograph", async () => {
    const executor = fakeExecutor({
      variants: [{ id: "tcv_2", trading_card_id: "tcard_2" }],
      photos: [],
      tcgdex: [{ trading_card_variant_id: "tcv_2", snapshot: { referenceArtworkUrl: "https://assets.tcgdex.net/card.webp" } }],
    })

    const result = await listThumbnailsForVariants(executor, ["tcv_2"], derivePublicImageUrl)

    expect(result.tcv_2).toEqual({ tradingCardId: "tcard_2", source: "TCGDEX", imageUrl: "https://assets.tcgdex.net/card.webp" })
  })

  it("falls back to TCGdex reference art when the photo exists but its URL cannot be derived", async () => {
    const executor = fakeExecutor({
      variants: [{ id: "tcv_3", trading_card_id: "tcard_3" }],
      photos: [{ trading_card_variant_id: "tcv_3", final_object_key: "card-images/tcv_3/photo.jpg" }],
      tcgdex: [{ trading_card_variant_id: "tcv_3", snapshot: { referenceArtworkUrl: "https://assets.tcgdex.net/fallback.webp" } }],
    })

    const result = await listThumbnailsForVariants(executor, ["tcv_3"], () => null)

    expect(result.tcv_3).toEqual({ tradingCardId: "tcard_3", source: "TCGDEX", imageUrl: "https://assets.tcgdex.net/fallback.webp" })
  })

  it("returns null imageUrl/source with the resolved tradingCardId when there is neither a photo nor TCGdex art", async () => {
    const executor = fakeExecutor({
      variants: [{ id: "tcv_4", trading_card_id: "tcard_4" }],
      photos: [],
      tcgdex: [],
    })

    const result = await listThumbnailsForVariants(executor, ["tcv_4"], derivePublicImageUrl)

    expect(result.tcv_4).toEqual({ tradingCardId: "tcard_4", source: null, imageUrl: null })
  })

  it("returns a fully null entry for a variant id that does not resolve, without querying photos or TCGdex for it", async () => {
    const executor = fakeExecutor({ variants: [], photos: [], tcgdex: [] })

    const result = await listThumbnailsForVariants(executor, ["tcv_unknown"], derivePublicImageUrl)

    expect(result.tcv_unknown).toEqual({ tradingCardId: null, source: null, imageUrl: null })
  })

  it("returns an empty object without querying anything when given no variant ids", async () => {
    const executor = fakeExecutor({ variants: [], photos: [], tcgdex: [] })

    const result = await listThumbnailsForVariants(executor, [], derivePublicImageUrl)

    expect(result).toEqual({})
    expect(executor.execute).not.toHaveBeenCalled()
  })
})
