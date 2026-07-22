/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@medusajs/ui"
import { MemoryRouter } from "react-router-dom"
import type { CardImageDetail, ImageListResponse, VariantThumbnailsResponse } from "../../../../components/imports/image-types"
import type { SnapshotEntryListResponse } from "../../../../components/imports/pulse-import-types"
import { rememberActiveImportSnapshot } from "../../../../components/imports/active-import-session"
import ImportsImagesPage from "../page"

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function baseListResponse(overrides: Partial<ImageListResponse> = {}): ImageListResponse {
  return {
    cards: [
      {
        trading_card_id: "tcard_1", card_name: "Pikachu", card_number: "025/100",
        card_set: { id: "tcset_1", display_name: "Base Set", language: "EN" },
        total_variant_count: 2, variants_missing_images: 1, ready_image_count: 3, need_status: "PARTIAL",
      },
    ],
    count: 1, limit: 20, offset: 0,
    ...overrides,
  }
}

function scopedEntriesResponse(overrides: Partial<SnapshotEntryListResponse> = {}): SnapshotEntryListResponse {
  return {
    entries: [{
      id: "entry_1",
      rowNumber: 1,
      providerReference: "card:base|025/100|Reverse Holo|null|null|null",
      quantity: 4,
      currencyCode: "GBP",
      unitAcquisitionCost: "0",
      unitMarketPrice: "1.50",
      unitSellingPrice: "2.00",
      conditionSource: null,
      conditionCandidate: "NEAR_MINT",
      finishCandidate: "REVERSE_HOLO",
      specialTreatmentCandidate: null,
      rarityCandidate: "COMMON",
      rarityRaw: "Common",
      languageConflict: false,
      outcome: "VALID",
      tradingCardVariantId: "tcvar_1",
      matchingStatus: "MATCHED",
      matchedVia: "TCGDEX",
      retryCount: 0,
      card: {
        tradingCardId: "tcard_1",
        name: "Pikachu",
        setDisplayName: "Base Set",
        cardNumber: "025/100",
        rarity: "COMMON",
        rarityRaw: "Common",
        condition: "NEAR_MINT",
        finish: "REVERSE_HOLO",
        specialTreatment: "NONE",
        sku: "PIKA-025",
      },
      cardIdentityHint: null,
      tcgdexCandidate: null,
    }],
    count: 1,
    limit: 20,
    offset: 0,
    ...overrides,
  }
}

const thumbnailResponse = (source: "PHOTO" | "TCGDEX" | null = "TCGDEX"): VariantThumbnailsResponse => ({
  thumbnails: {
    tcvar_1: {
      tradingCardId: "tcard_1",
      imageUrl: source ? "https://assets.example/pikachu.png" : null,
      source,
    },
  },
})

const cardImageDetail: CardImageDetail = {
  trading_card: { id: "tcard_1", name: "Pikachu", card_number: "025/100" },
  card_set: { id: "tcset_1", display_name: "Base Set", language: "EN" },
  tcgdex_reference_artwork_url: "https://assets.example/pikachu.png",
  variants: [{
    id: "tcvar_1",
    sku: "PIKA-025",
    condition: "NEAR_MINT",
    finish: "REVERSE_HOLO",
    special_treatment: "NONE",
    ready_images: [],
    archived_images: [],
  }],
}

function scopedFetch(url: string, entries = scopedEntriesResponse(), thumbnails = thumbnailResponse()) {
  if (url.includes("/summary")) {
    return mockResponse({ imageReadiness: { ready: true, totalMatchedCards: 1, cardsWithPhoto: 1 } })
  }
  if (url.includes("/entries?")) return mockResponse(entries)
  if (url.includes("/variants/images?")) return mockResponse(thumbnails)
  if (url.includes("/diagnostics?")) return mockResponse({ diagnostics: [], count: 0, limit: 50, offset: 0 })
  if (url.includes("/trading-cards/tcard_1/images")) return mockResponse(cardImageDetail)
  if (url.includes("/trading-cards/tcard_2/images")) {
    return mockResponse({
      ...cardImageDetail,
      trading_card: { id: "tcard_2", name: "Raichu", card_number: "026/100" },
      variants: [{ ...cardImageDetail.variants[0], id: "tcvar_2", sku: "RAI-026" }],
    })
  }
  return mockResponse(baseListResponse())
}

function renderPage(fetchImpl: (url: string) => Promise<unknown>, initialEntry = "/imports/images") {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => fetchImpl(String(input)))
  global.fetch = fetchMock as unknown as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <ImportsImagesPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { fetchMock }
}

describe("ImportsImagesPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it("shows a loading state, then the list", async () => {
    renderPage(async () => mockResponse(baseListResponse()))
    await screen.findByText("Pikachu")
  })

  it("shows an empty state when there are no cards", async () => {
    renderPage(async () => mockResponse(baseListResponse({ cards: [], count: 0 })))
    await screen.findByText("No cards need images.")
  })

  it("shows an error state when the request fails", async () => {
    renderPage(async () => mockResponse({ message: "boom" }, 500))
    await screen.findByText("This could not be loaded. Please try again.")
  })

  it("re-fetches with the search term when the admin searches", async () => {
    const { fetchMock } = renderPage(async () => mockResponse(baseListResponse()))
    await screen.findByText("Pikachu")

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText("Search cards"), "Pika")

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("q=Pika"),
        expect.anything()
      )
    })
  })

  it("scopes to the snapshot's cards when reached with ?snapshotId=, and can switch to the full catalogue", async () => {
    const { fetchMock } = renderPage(async (url) => scopedFetch(url), "/imports/images?snapshotId=tcisnap_1")
    await screen.findByText("Showing only cards from this import.")
    await screen.findByText("Pikachu")
    expect(screen.getByRole("button", { name: "Back: Sync with TCGDex" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next: Check and approve →" })).toBeEnabled()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/snapshots/tcisnap_1/entries?"),
      expect.anything(),
    )
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/proposals"), expect.anything())
  })

  it("scopes the snapshot-entries query to only MATCHED rows — a row still awaiting Step 2 review isn't eligible for a photo yet", async () => {
    const { fetchMock } = renderPage(async (url) => scopedFetch(url), "/imports/images?snapshotId=tcisnap_1")
    await screen.findByText("Pikachu")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("reviewStatus=MATCHED"),
      expect.anything(),
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "View the full catalogue instead" }))
    expect(screen.queryByText("Showing only cards from this import.")).not.toBeInTheDocument()
  })

  it("keeps Check and approve disabled until every matched card has an uploaded image", async () => {
    renderPage(async (url) => {
      if (url.includes("/summary")) {
        return mockResponse({ imageReadiness: { ready: false, totalMatchedCards: 2, cardsWithPhoto: 1 } })
      }
      return scopedFetch(url)
    }, "/imports/images?snapshotId=tcisnap_1")

    expect(await screen.findByText("Upload images for all 2 cards to continue.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next: Check and approve →" })).toBeDisabled()
  })

  it("restores the active import when Step 3 is opened without a snapshot query parameter", async () => {
    rememberActiveImportSnapshot("tcisnap_1")
    const { fetchMock } = renderPage(async (url) => scopedFetch(url))

    await screen.findByText("Showing only cards from this import.")
    await screen.findByText("Pikachu")
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/snapshots/tcisnap_1/entries?"),
      expect.anything(),
    )
    expect(screen.getByRole("button", { name: "Back: Sync with TCGDex" })).toBeInTheDocument()
  })

  it("shows a friendly empty state when scoped to a snapshot with no cards needing images", async () => {
    renderPage(
      async (url) => scopedFetch(url, scopedEntriesResponse({ entries: [], count: 0 })),
      "/imports/images?snapshotId=tcisnap_1",
    )

    await screen.findByText("No cards were found in this import.")
  })

  it("shows the Step 2 card columns and opens the upload modal from a missing-photo placeholder", async () => {
    renderPage(async (url) => scopedFetch(url), "/imports/images?snapshotId=tcisnap_1")

    await screen.findByText("Pikachu")
    expect(screen.getByRole("columnheader", { name: "Card name" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Quantity" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Image status" })).toBeInTheDocument()
    expect(screen.getByText("Image Needed")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "Upload image for Pikachu" })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Upload image for Pikachu" }))

    expect(await screen.findByRole("heading", { name: "Card photograph" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Pikachu" })).not.toBeInTheDocument()
  })

  it("opens the Step 2 detail drawer when a scoped card row is clicked", async () => {
    renderPage(async (url) => scopedFetch(url), "/imports/images?snapshotId=tcisnap_1")
    const user = userEvent.setup()

    await user.click(await screen.findByText("Pikachu"))

    const drawerHeading = await screen.findByRole("heading", { name: "Pikachu" })
    expect(drawerHeading).toBeInTheDocument()
    expect(screen.getByText("Card number")).toBeInTheDocument()
    expect(screen.getByText("No diagnostics for this row.")).toBeInTheDocument()
  })

  it("moves directly to the next card from the compact upload modal", async () => {
    const firstEntry = scopedEntriesResponse().entries[0]
    const secondEntry = {
      ...firstEntry,
      id: "entry_2",
      rowNumber: 2,
      providerReference: "card:base|026/100|Reverse Holo|null|null|null",
      tradingCardVariantId: "tcvar_2",
      card: { ...firstEntry.card!, tradingCardId: "tcard_2", name: "Raichu", cardNumber: "026/100", sku: "RAI-026" },
    }
    const entries = scopedEntriesResponse({ entries: [firstEntry, secondEntry], count: 2 })
    const thumbnails: VariantThumbnailsResponse = {
      thumbnails: {
        ...thumbnailResponse().thumbnails,
        tcvar_2: { tradingCardId: "tcard_2", imageUrl: null, source: null },
      },
    }
    renderPage(async (url) => scopedFetch(url, entries, thumbnails), "/imports/images?snapshotId=tcisnap_1")
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Upload image for Pikachu" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Pikachu")).toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "Next card →" }))
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("Raichu")).toBeInTheDocument())
  })
})
