/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { TooltipProvider } from "@medusajs/ui"
import ImportsSnapshotDetailPage from "../page"

jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui")
  return { ...actual, toast: { ...actual.toast, success: jest.fn(), error: jest.fn(), info: jest.fn() } }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedUi = jest.requireMock("@medusajs/ui") as { toast: { success: jest.Mock; error: jest.Mock; info: jest.Mock } }

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const BASE_SUMMARY = {
  snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "VALIDATED",
  inventorySourceDisplayName: "Pulse London", inventorySourceLanguage: "EN",
  originalFilename: "import.csv", contentHash: "abc123", rowCount: 2,
  byOutcome: { VALID: 2 } as Record<string, number>,
  byMatchingStatus: { UNMATCHED: 1, MATCHED: 1 } as Record<string, number>,
  byDiagnosticSeverity: { WARNING: 1 } as Record<string, number>,
  uniqueProviderReferences: 2, duplicateRowCount: 0,
  approvedCardCount: 0, approvedQuantity: 0,
}

const BASE_ENTRIES = {
  entries: [
    {
      id: "tcisentry_1", rowNumber: 1, providerReference: "card:sv1|066/196|holo|nm", quantity: 2,
      currencyCode: "GBP", unitAcquisitionCost: "1.50", unitMarketPrice: "3.00", unitSellingPrice: "4.00",
      conditionSource: "EXPLICIT", finishCandidate: "HOLO", specialTreatmentCandidate: null, rarityCandidate: "COMMON",
      rarityRaw: "Common", languageConflict: false, outcome: "VALID", tradingCardVariantId: null,
      matchingStatus: "UNMATCHED", matchedVia: "NONE", retryCount: 0, tcgdexCandidate: null,
    },
  ],
  count: 1, limit: 20, offset: 0,
}

const BASE_DIAGNOSTICS = {
  diagnostics: [
    { id: "tcisediag_1", snapshotEntryId: "tcisentry_1", rowNumber: 1, phase: "MATCHING", code: "NO_VARIANT_MATCH", severity: "INFO", fieldRef: null, message: "No existing trading-card variant matches this row." },
  ],
  count: 1, limit: 20, offset: 0,
}

const BASE_PROGRESS = {
  totalProposals: 0, pending: 0, approved: 0, rejected: 0, appliedFullySynced: 0, appliedSyncPending: 0,
  appliedSyncFailed: 0, blocked: 0, outOfScope: 0, allReviewed: false, allApplicableApplied: false, fullyComplete: false,
}

const READY_IMAGE_READINESS = { ready: true, totalMatchedCards: 1, cardsWithPhoto: 1 }

function renderPage(
  summaryOverrides: Partial<typeof BASE_SUMMARY> = {},
  extra: {
    entries?: { entries: Record<string, unknown>[]; count: number; limit: number; offset: number }
    proposals?: unknown[]; thumbnails?: Record<string, unknown>
    progress?: Partial<typeof BASE_PROGRESS>; imageReadiness?: typeof READY_IMAGE_READINESS
    cardImageDetail?: unknown
  } = {},
) {
  const summary = { ...BASE_SUMMARY, ...summaryOverrides }
  const entries = extra.entries ?? BASE_ENTRIES
  const proposals = extra.proposals ?? []
  const thumbnails = extra.thumbnails ?? {}
  const progress = extra.progress ? { ...BASE_PROGRESS, ...extra.progress } : undefined
  const imageReadiness = extra.imageReadiness
  const cardImageDetail = extra.cardImageDetail ?? { trading_card: { id: "tcard_1", name: "Test", card_number: "1" }, card_set: { id: "s1", display_name: "Set", language: "EN" }, tcgdex_reference_artwork_url: null, variants: [] }
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method === "POST" && url.includes("/retry-matching")) {
      return mockResponse({ result: { kind: "IMPORTED", snapshotId: "tcisnap_1" } })
    }
    if (method === "POST" && url.includes("/reconcile")) {
      return mockResponse({ summary: { proposalCount: 1 } })
    }
    if (method === "POST" && url.includes("/tcgdex-lookup/review")) {
      return mockResponse({ results: [{ candidateId: "tclookup_1", createdVariantCount: 1, skippedRowCount: 0, errors: [] }] })
    }
    if (url.includes("/provider-set-mappings/unmapped")) {
      return mockResponse({ language: "EN", unmappedSetCodes: [] })
    }
    if (url.includes("/summary")) return mockResponse({ summary, progress, imageReadiness })
    if (url.includes("/entries")) return mockResponse(entries)
    if (url.includes("/diagnostics")) return mockResponse(BASE_DIAGNOSTICS)
    if (url.includes("/admin/trading-card-inventory/proposals")) return mockResponse({ proposals, count: proposals.length, limit: 100, offset: 0 })
    if (url.includes("/admin/trading-cards/variants/images")) return mockResponse({ thumbnails })
    if (url.includes("/admin/trading-cards/") && url.includes("/images")) return mockResponse(cardImageDetail)
    throw new Error(`Unexpected fetch: ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/imports/snapshots/tcisnap_1"]}>
          <Routes>
            <Route path="/imports/snapshots/:id" element={<ImportsSnapshotDetailPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { fetchMock }
}

describe("ImportsSnapshotDetailPage", () => {
  beforeEach(() => {
    mockedUi.toast.success.mockClear()
    mockedUi.toast.error.mockClear()
  })

  it("renders the summary panel and the entries and diagnostics tables", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("import.csv")
    expect(screen.getByText("Validated")).toBeInTheDocument()
    expect(await screen.findByText("Not yet matched")).toBeInTheDocument()
    expect(screen.getByText("£1.50")).toBeInTheDocument()
    expect(screen.getByText("£3.00")).toBeInTheDocument()
    expect(screen.getByText("£4.00")).toBeInTheDocument()
    expect(screen.getByText("Approved cards")).toBeInTheDocument()
    expect(screen.getByText("Approved quantity")).toBeInTheDocument()
    expect(screen.getByText("Cards")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Diagnostics/ }))
    expect(await screen.findByText("No existing trading-card variant matches this row.")).toBeInTheDocument()
  })

  it("shows a placeholder image with no click target for an unmatched row without a create-card proposal", async () => {
    renderPage()
    await screen.findByText("import.csv")
    expect(screen.queryByRole("button", { name: "card:sv1|066/196|holo|nm" })).not.toBeInTheDocument()
  })

  it("opens Create card when an unmatched row's placeholder image has a matching proposal", async () => {
    const user = userEvent.setup()
    const proposal = {
      id: "tciprop_1", inventorySourceId: "tcisrc_1", inventorySnapshotId: "tcisnap_1", tradingCardVariantId: null,
      card: null, cardIdentityHint: "SV1 066/196", providerReference: "card:sv1|066/196|holo|nm",
      previousQuantity: null, proposedQuantity: null, quantityDelta: null, changeKind: "UNRESOLVED_VARIANT",
      reviewStatus: "PENDING", resolvedBy: null, resolvedAt: null, reviewNote: null, appliedAt: null,
      appliedTransactionId: null, medusaSyncStatus: "NOT_APPLICABLE", medusaInventoryItemId: null,
      medusaStockLocationId: null, medusaSyncRetryCount: 0, medusaSyncLastError: null, createdAt: "2024-01-01T00:00:00.000Z",
    }
    renderPage({}, { proposals: [proposal] })
    await screen.findByText("import.csv")

    await user.click(await screen.findByRole("button", { name: "card:sv1|066/196|holo|nm" }))
    expect(await screen.findByRole("heading", { name: "Create card" })).toBeInTheDocument()
  })

  it("opens Create card (not the pending-review checkbox) for a row whose candidate was accepted but the card was skipped", async () => {
    const user = userEvent.setup()
    const candidateEntries = {
      entries: [{
        ...BASE_ENTRIES.entries[0],
        tcgdexCandidate: {
          id: "tclookup_1", name: "Gengar", setName: "Ascended Heroes", seriesName: "Mega Evolution",
          referenceArtworkUrl: "https://assets.example/gengar.png", providerRarity: "Rare",
        },
      }],
      count: 1, limit: 20, offset: 0,
    }
    const proposal = {
      id: "tciprop_1", inventorySourceId: "tcisrc_1", inventorySnapshotId: "tcisnap_1", tradingCardVariantId: null,
      card: null, cardIdentityHint: "SV1 066/196", providerReference: "card:sv1|066/196|holo|nm",
      previousQuantity: null, proposedQuantity: null, quantityDelta: null, changeKind: "UNRESOLVED_VARIANT",
      reviewStatus: "PENDING", resolvedBy: null, resolvedAt: null, reviewNote: null, appliedAt: null,
      appliedTransactionId: null, medusaSyncStatus: "NOT_APPLICABLE", medusaInventoryItemId: null,
      medusaStockLocationId: null, medusaSyncRetryCount: 0, medusaSyncLastError: null, createdAt: "2024-01-01T00:00:00.000Z",
    }
    renderPage({}, { entries: candidateEntries, proposals: [proposal] })
    await screen.findByText("import.csv")

    expect(screen.queryByRole("checkbox", { name: "Select Gengar" })).not.toBeInTheDocument()

    await user.click(await screen.findByRole("button", { name: "card:sv1|066/196|holo|nm" }))
    expect(await screen.findByRole("heading", { name: "Create card" })).toBeInTheDocument()
  })

  it("opens a preview modal with the full-size image when a matched row's thumbnail is clicked", async () => {
    const user = userEvent.setup()
    const matchedEntries = {
      entries: [{ ...BASE_ENTRIES.entries[0], tradingCardVariantId: "tcvar_1" }],
      count: 1, limit: 20, offset: 0,
    }
    renderPage({}, {
      entries: matchedEntries,
      thumbnails: { tcvar_1: { tradingCardId: "tcard_1", imageUrl: "https://img.example/photo.jpg", source: "PHOTO" } },
    })
    await screen.findByText("import.csv")

    await user.click(await screen.findByRole("button", { name: "card:sv1|066/196|holo|nm" }))
    expect(await screen.findByRole("img", { name: "card:sv1|066/196|holo|nm" })).toHaveAttribute("src", "https://img.example/photo.jpg")
    expect(screen.queryByText("Card photograph")).not.toBeInTheDocument()
  })

  it("keeps accepted TCGdex artwork and rarity visible after a row becomes matched", async () => {
    const user = userEvent.setup()
    const acceptedEntry = {
      ...BASE_ENTRIES.entries[0],
      rarityCandidate: null,
      rarityRaw: "—",
      tradingCardVariantId: "tcvar_absol",
      matchingStatus: "MATCHED",
      card: {
        tradingCardId: "tcard_absol", name: "Absol", setDisplayName: "Phantasmal Flames", cardNumber: "063/094",
        rarity: null, rarityRaw: "Common", condition: "NEAR_MINT", finish: "REVERSE_HOLO", specialTreatment: "NONE", sku: "ABSOL",
      },
      tcgdexCandidate: {
        id: "tclookup_absol", reviewStatus: "ACCEPTED", name: "Absol", setName: "Phantasmal Flames",
        seriesName: "Mega Evolution", referenceArtworkUrl: "https://assets.tcgdex.net/absol.webp", providerRarity: "Common",
      },
    }
    renderPage({}, {
      entries: { entries: [acceptedEntry], count: 1, limit: 20, offset: 0 },
      thumbnails: { tcvar_absol: { tradingCardId: "tcard_absol", imageUrl: null, source: null } },
    })
    await screen.findByText("import.csv")

    const table = screen.getByRole("table")
    expect(within(table).getByText("Common")).toBeInTheDocument()
    expect(within(table).getByText("Matched")).toBeInTheDocument()
    expect(within(table).getByRole("img", { name: acceptedEntry.providerReference })).toHaveAttribute(
      "src", "https://assets.tcgdex.net/absol.webp",
    )

    await user.click(within(table).getByText("Absol"))
    const drawer = await screen.findByRole("dialog")
    expect(within(drawer).getByRole("img", { name: "Absol" })).toHaveAttribute("src", "https://assets.tcgdex.net/absol.webp")
    expect(within(drawer).getByText("Matched")).toBeInTheDocument()
  })

  it("opens the replace-image dialog from within the image preview modal", async () => {
    const user = userEvent.setup()
    const matchedEntries = {
      entries: [{ ...BASE_ENTRIES.entries[0], tradingCardVariantId: "tcvar_1" }],
      count: 1, limit: 20, offset: 0,
    }
    renderPage({}, {
      entries: matchedEntries,
      thumbnails: { tcvar_1: { tradingCardId: "tcard_1", imageUrl: "https://img.example/photo.jpg", source: "PHOTO" } },
    })
    await screen.findByText("import.csv")

    await user.click(await screen.findByRole("button", { name: "card:sv1|066/196|holo|nm" }))
    await user.click(await screen.findByRole("button", { name: "Replace image" }))
    expect(await screen.findByText("Card photograph")).toBeInTheDocument()
  })

  it("skips the preview modal and opens the replace dialog directly for a matched row with no image yet", async () => {
    const user = userEvent.setup()
    const matchedEntries = {
      entries: [{ ...BASE_ENTRIES.entries[0], tradingCardVariantId: "tcvar_1" }],
      count: 1, limit: 20, offset: 0,
    }
    renderPage({}, {
      entries: matchedEntries,
      thumbnails: { tcvar_1: { tradingCardId: "tcard_1", imageUrl: null, source: null } },
    })
    await screen.findByText("import.csv")

    await user.click(await screen.findByRole("button", { name: "card:sv1|066/196|holo|nm" }))
    expect(await screen.findByText("Card photograph")).toBeInTheDocument()
  })

  it("steers to Assign card images, not Review proposals, when images are not ready yet", async () => {
    renderPage({}, {
      progress: { totalProposals: 2, pending: 2 },
      imageReadiness: { ready: false, totalMatchedCards: 1, cardsWithPhoto: 0 },
    })
    await screen.findByText("import.csv")

    const actionRow = screen.getByRole("button", { name: "Back to upload" }).parentElement
    expect(actionRow).not.toBeNull()
    expect(within(actionRow!).getByRole("button", { name: "Next: Assign card images →" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next: Review proposals →" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "View proposals" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Inventory proposals" })).not.toBeInTheDocument()
  })

  it("renders Back to upload as a button", async () => {
    renderPage()
    await screen.findByText("import.csv")

    expect(screen.getByRole("button", { name: "Back to upload" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Back to upload" })).not.toBeInTheDocument()
  })

  it("offers Review proposals once every matched card has a photo and nothing is left unmatched", async () => {
    renderPage({ byMatchingStatus: { MATCHED: 2 } }, {
      progress: { totalProposals: 2, pending: 2 },
      imageReadiness: READY_IMAGE_READINESS,
    })
    await screen.findByText("import.csv")

    const actionRow = screen.getByRole("button", { name: "Back to upload" }).parentElement
    expect(actionRow).not.toBeNull()
    expect(within(actionRow!).getByRole("button", { name: "Next: Review proposals →" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next: Assign card images →" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Inventory proposals" })).not.toBeInTheDocument()
  })

  it("opens the row detail drawer when a row is clicked", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("import.csv")

    await user.click(screen.getByText("Not yet matched"))
    expect(await screen.findByText("Import row 1")).toBeInTheDocument()
  })

  it("shows the card image and import details in the widened row drawer", async () => {
    const user = userEvent.setup()
    const candidateEntries = {
      entries: [{
        ...BASE_ENTRIES.entries[0],
        specialTreatmentCandidate: "DUSK_BALL_REVERSE",
        tcgdexCandidate: {
          id: "tclookup_1", name: "Gengar", setName: "Ascended Heroes", seriesName: "Mega Evolution",
          referenceArtworkUrl: "https://assets.example/gengar.png", providerRarity: "Rare",
        },
      }],
      count: 1, limit: 20, offset: 0,
    }
    renderPage({}, { entries: candidateEntries })
    await screen.findByText("import.csv")

    await user.click(screen.getByText("Gengar"))
    const drawer = await screen.findByRole("dialog")

    expect(within(drawer).getByRole("img", { name: "Gengar" })).toHaveAttribute("src", "https://assets.example/gengar.png")
    expect(within(drawer).getByText("Card number")).toBeInTheDocument()
    expect(within(drawer).getByText("066 / 196")).toBeInTheDocument()
    expect(within(drawer).getByText("Mega Evolution")).toBeInTheDocument()
    expect(within(drawer).getByText("Ascended Heroes")).toBeInTheDocument()
    expect(within(drawer).getByText("Dusk Ball Reverse")).toBeInTheDocument()
    expect(within(drawer).getByText("Market price")).toBeInTheDocument()
    expect(within(drawer).getByText("Awaiting review")).toBeInTheDocument()
    expect(within(drawer).getByText("This card will be linked or created when approved.")).toBeInTheDocument()
    expect(within(drawer).queryByText("Treatment")).not.toBeInTheDocument()
  })

  it("navigates between visible cards from the bottom of the row drawer", async () => {
    const user = userEvent.setup()
    const entries = {
      entries: [
        {
          ...BASE_ENTRIES.entries[0],
          tcgdexCandidate: {
            id: "tclookup_1", name: "Gengar", setName: "Ascended Heroes", seriesName: "Mega Evolution",
            referenceArtworkUrl: null, providerRarity: "Rare",
          },
        },
        {
          ...BASE_ENTRIES.entries[0],
          id: "tcisentry_2", rowNumber: 2, providerReference: "card:sv1|067/196|holo|nm",
          tcgdexCandidate: {
            id: "tclookup_2", name: "Hypno", setName: "Ascended Heroes", seriesName: "Mega Evolution",
            referenceArtworkUrl: null, providerRarity: "Rare",
          },
        },
      ],
      count: 2, limit: 20, offset: 0,
    }
    renderPage({}, { entries })
    await screen.findByText("import.csv")

    await user.click(screen.getByText("Gengar"))
    const drawer = await screen.findByRole("dialog")
    expect(within(drawer).getByRole("heading", { name: "Gengar" })).toBeInTheDocument()
    expect(within(drawer).getByRole("button", { name: "← Previous" })).toBeDisabled()

    await user.click(within(drawer).getByRole("button", { name: "Next →" }))
    expect(within(drawer).getByRole("heading", { name: "Hypno" })).toBeInTheDocument()
    expect(within(drawer).getByText("Import row 2")).toBeInTheDocument()
    expect(within(drawer).getByRole("button", { name: "Next →" })).toBeDisabled()

    await user.click(within(drawer).getByRole("button", { name: "← Previous" }))
    expect(within(drawer).getByRole("heading", { name: "Gengar" })).toBeInTheDocument()
  })

  it("shows the primary uploaded photograph, TCGDex hover comparison, and uploaded-image carousel in the row drawer", async () => {
    const user = userEvent.setup()
    const matchedEntry = {
      ...BASE_ENTRIES.entries[0],
      tradingCardVariantId: "tcvar_absol",
      matchingStatus: "MATCHED",
      card: {
        tradingCardId: "tcard_absol", name: "Absol", setDisplayName: "Phantasmal Flames", cardNumber: "063/094",
        rarity: "COMMON", rarityRaw: "Common", condition: "NEAR_MINT", finish: "REVERSE_HOLO", specialTreatment: "NONE", sku: "ABSOL",
      },
    }
    renderPage({}, {
      entries: { entries: [matchedEntry], count: 1, limit: 20, offset: 0 },
      thumbnails: { tcvar_absol: { tradingCardId: "tcard_absol", imageUrl: "https://images.example/front.jpg", source: "PHOTO" } },
      cardImageDetail: {
        trading_card: { id: "tcard_absol", name: "Absol", card_number: "063/094" },
        card_set: { id: "set_1", display_name: "Phantasmal Flames", language: "EN" },
        tcgdex_reference_artwork_url: "https://assets.tcgdex.net/absol.webp",
        variants: [{
          id: "tcvar_absol", sku: "ABSOL", condition: "NEAR_MINT", finish: "REVERSE_HOLO", special_treatment: "NONE",
          ready_images: [
            { id: "img_1", status: "READY", tradingCardVariantId: "tcvar_absol", originalFilename: "front.jpg", confirmedMimeType: "image/jpeg", width: 800, height: 1000, sortOrder: 0, focalX: 0.5, focalY: 0.5, imageUrl: "https://images.example/front.jpg", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
            { id: "img_2", status: "READY", tradingCardVariantId: "tcvar_absol", originalFilename: "back.jpg", confirmedMimeType: "image/jpeg", width: 800, height: 1000, sortOrder: 1, focalX: 0.5, focalY: 0.5, imageUrl: "https://images.example/back.jpg", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
          ],
          archived_images: [],
        }],
      },
    })
    await screen.findByText("import.csv")

    await user.click(screen.getByText("Absol"))
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByRole("img", { name: "Absol" })).toHaveAttribute("src", "https://images.example/front.jpg")
    expect(within(drawer).getByRole("img", { name: "Absol TCGDex reference" })).toHaveAttribute("src", "https://assets.tcgdex.net/absol.webp")
    expect(within(drawer).getByText("Hover over the photograph to view the TCGDex image.")).toBeInTheDocument()

    await user.click(within(drawer).getByRole("button", { name: "Next uploaded image" }))
    expect(within(drawer).getByRole("img", { name: "Absol" })).toHaveAttribute("src", "https://images.example/back.jpg")
    expect(within(drawer).getByText("Uploaded image 2 of 2")).toBeInTheDocument()
  })

  it("shows a TCGdex candidate's name and a checkbox directly in the Rows table, and accepting it clears the selection", async () => {
    const user = userEvent.setup()
    const candidateEntries = {
      entries: [{
        ...BASE_ENTRIES.entries[0],
        tcgdexCandidate: {
          id: "tclookup_1", name: "Gengar", setName: "Ascended Heroes", seriesName: "Mega Evolution",
          referenceArtworkUrl: null, providerRarity: "Rare",
        },
      }],
      count: 1, limit: 20, offset: 0,
    }
    const { fetchMock } = renderPage({}, { entries: candidateEntries })
    await screen.findByText("import.csv")

    expect(await screen.findByText("Gengar")).toBeInTheDocument()
    expect(screen.getByText("Mega Evolution · Ascended Heroes")).toBeInTheDocument()
    expect(within(screen.getByRole("table")).getByText("Awaiting review")).toBeInTheDocument()
    expect(screen.queryByText("Found on TCGdex", { exact: false })).not.toBeInTheDocument()

    const checkbox = screen.getByRole("checkbox", { name: "Select Gengar" })
    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    expect(screen.getByText("1 selected")).toBeInTheDocument()

    await user.click(await screen.findByRole("button", { name: "Approve selected" }))

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("1 card variant created"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-card-inventory/imports/snapshots/tcisnap_1/tcgdex-lookup/review",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ candidateIds: ["tclookup_1"], action: "ACCEPT" }) })
    )
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument()
  })

  it("selects a range of rows with shift-click", async () => {
    const user = userEvent.setup()
    const makeCandidate = (id: string, name: string) => ({
      id, name, setName: "Ascended Heroes", seriesName: "Mega Evolution", referenceArtworkUrl: null, providerRarity: "Rare",
    })
    const candidateEntries = {
      entries: [
        { ...BASE_ENTRIES.entries[0], id: "tcisentry_1", providerReference: "card:sv1|001/196|holo|nm", tcgdexCandidate: makeCandidate("tclookup_1", "Gengar") },
        { ...BASE_ENTRIES.entries[0], id: "tcisentry_2", providerReference: "card:sv1|002/196|holo|nm", tcgdexCandidate: makeCandidate("tclookup_2", "Hypno") },
        { ...BASE_ENTRIES.entries[0], id: "tcisentry_3", providerReference: "card:sv1|003/196|holo|nm", tcgdexCandidate: makeCandidate("tclookup_3", "Absol") },
      ],
      count: 3, limit: 20, offset: 0,
    }
    renderPage({}, { entries: candidateEntries })
    await screen.findByText("import.csv")

    await user.click(screen.getByRole("checkbox", { name: "Select Gengar" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Absol" }), { shiftKey: true })

    expect(screen.getByRole("checkbox", { name: "Select Gengar" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Select Hypno" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Select Absol" })).toBeChecked()
    expect(screen.getByText("3 selected")).toBeInTheDocument()
  })

  it("selects and deselects all visible canonical TCGdex matches from the table header", async () => {
    const user = userEvent.setup()
    const candidateEntries = {
      entries: [
        {
          ...BASE_ENTRIES.entries[0],
          id: "tcisentry_1",
          tcgdexCandidate: {
            id: "tclookup_1", name: "Gengar", setName: "Ascended Heroes", seriesName: "Mega Evolution",
            referenceArtworkUrl: null, providerRarity: "Rare",
          },
        },
        {
          ...BASE_ENTRIES.entries[0],
          id: "tcisentry_2",
          rowNumber: 2,
          tcgdexCandidate: {
            id: "tclookup_1", name: "Gengar", setName: "Ascended Heroes", seriesName: "Mega Evolution",
            referenceArtworkUrl: null, providerRarity: "Rare",
          },
        },
        {
          ...BASE_ENTRIES.entries[0],
          id: "tcisentry_3",
          rowNumber: 3,
          providerReference: "card:sv1|067/196|holo|nm",
          tcgdexCandidate: {
            id: "tclookup_2", name: "Hypno", setName: "Ascended Heroes", seriesName: "Mega Evolution",
            referenceArtworkUrl: null, providerRarity: "Rare",
          },
        },
      ],
      count: 3, limit: 20, offset: 0,
    }
    renderPage({}, { entries: candidateEntries })
    await screen.findByText("import.csv")

    const selectAll = screen.getByRole("checkbox", { name: "Select all TCGdex matches on this page" })
    await user.click(selectAll)

    expect(selectAll).toBeChecked()
    screen.getAllByRole("checkbox", { name: "Select Gengar" }).forEach((checkbox) => expect(checkbox).toBeChecked())
    expect(screen.getByRole("checkbox", { name: "Select Hypno" })).toBeChecked()
    expect(screen.getByText("2 selected")).toBeInTheDocument()

    await user.click(selectAll)

    expect(selectAll).not.toBeChecked()
    screen.getAllByRole("checkbox", { name: /Select (Gengar|Hypno)/ }).forEach((checkbox) => expect(checkbox).not.toBeChecked())
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument()
  })

  it("labels the special-treatment column as Variant", async () => {
    renderPage()
    await screen.findByText("import.csv")

    expect(screen.getByRole("columnheader", { name: "Variant" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sort by Variant" })).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Treatment" })).not.toBeInTheDocument()
  })

  it("shows a sortable Set column and requests card-name sort direction", async () => {
    const user = userEvent.setup()
    const entries = {
      entries: [
        {
          ...BASE_ENTRIES.entries[0],
          tcgdexCandidate: {
            id: "tclookup_1", name: "Zubat", setName: "Chaos Rising", seriesName: "Mega Evolution",
            referenceArtworkUrl: null, providerRarity: "Common",
          },
        },
        {
          ...BASE_ENTRIES.entries[0],
          id: "tcisentry_2", rowNumber: 2, providerReference: "card:me04|001/086|Reverse Holo|nm",
          tcgdexCandidate: {
            id: "tclookup_2", name: "Abra", setName: "Chaos Rising", seriesName: "Mega Evolution",
            referenceArtworkUrl: null, providerRarity: "Common",
          },
        },
      ],
      count: 2, limit: 20, offset: 0,
    }
    const { fetchMock } = renderPage({}, { entries })
    await screen.findByText("import.csv")

    const table = screen.getByRole("table")
    expect(within(table).getByRole("columnheader", { name: "Set" })).toBeInTheDocument()
    expect(within(table).getByRole("button", { name: "Sort by Set" })).toBeInTheDocument()
    fetchMock.mockClear()

    await user.click(within(table).getByRole("button", { name: "Sort by Card name" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/sortBy=cardName.*sortDirection=desc/),
      { credentials: "include" },
    ))
  })

  it("keeps review actions visible and disabled until a candidate is selected", async () => {
    renderPage()
    await screen.findByText("import.csv")

    expect(screen.getByRole("button", { name: "Approve selected" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled()
  })

  it("does not display the Pulse reference column", async () => {
    renderPage()
    await screen.findByText("import.csv")

    expect(screen.queryByRole("columnheader", { name: "Reference" })).not.toBeInTheDocument()
  })

  it("shows reconciliation only while VALIDATED", async () => {
    renderPage()
    await screen.findByText("import.csv")
    expect(screen.getByRole("button", { name: "Trigger reconciliation" })).toBeInTheDocument()
  })

  it("hides reconciliation once the snapshot is no longer VALIDATED", async () => {
    renderPage({ status: "PENDING_REVIEW", byMatchingStatus: { MATCHED: 2 } })
    await screen.findByText("import.csv")
    expect(screen.queryByRole("button", { name: "Trigger reconciliation" })).not.toBeInTheDocument()
  })

  it("triggers reconciliation and shows a success toast", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findByText("import.csv")

    await user.click(screen.getByRole("button", { name: "Trigger reconciliation" }))

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Reconciliation started"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-card-inventory/imports/snapshots/tcisnap_1/reconcile",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("requests the semantic awaiting-review filter", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findByText("import.csv")
    fetchMock.mockClear()

    await user.selectOptions(screen.getByLabelText("Filter by review status"), "AWAITING_REVIEW")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("reviewStatus=AWAITING_REVIEW"),
      { credentials: "include" },
    ))
  })

  it("requests only rows needing action by default", async () => {
    const { fetchMock } = renderPage()
    await screen.findByText("import.csv")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("reviewStatus=ACTION_REQUIRED"),
      { credentials: "include" },
    )
    expect(screen.getByLabelText("Filter by review status")).toHaveValue("ACTION_REQUIRED")
  })

  it("re-fetches entries with the outcome filter applied", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage({ byOutcome: { VALID: 1, INVALID: 1 } })
    await screen.findByText("import.csv")
    fetchMock.mockClear()

    await user.selectOptions(screen.getByLabelText("Filter by outcome"), "INVALID")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("outcome=INVALID"),
      { credentials: "include" }
    ))
  })

  it("links a diagnostic row back to its snapshot entry", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findByText("import.csv")
    await user.click(screen.getByRole("button", { name: /Diagnostics/ }))
    await screen.findByText("No existing trading-card variant matches this row.")
    fetchMock.mockClear()

    await user.click(screen.getAllByRole("button", { name: "1" })[0])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("snapshotEntryId=tcisentry_1"),
      { credentials: "include" },
    ))
  })
})
