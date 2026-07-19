/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
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
}

const BASE_ENTRIES = {
  entries: [
    {
      id: "tcisentry_1", rowNumber: 1, providerReference: "card:sv1|066/196|holo|nm", quantity: 2,
      currencyCode: "GBP", unitAcquisitionCost: "1.50", unitMarketPrice: "3.00", unitSellingPrice: "4.00",
      conditionSource: "EXPLICIT", finishCandidate: "HOLO", specialTreatmentCandidate: null, rarityCandidate: "COMMON",
      rarityRaw: "Common", languageConflict: false, outcome: "VALID", tradingCardVariantId: null,
      matchingStatus: "UNMATCHED", matchedVia: "NONE", retryCount: 0,
    },
  ],
  count: 1, limit: 20, offset: 0,
}

const BASE_DIAGNOSTICS = {
  diagnostics: [
    { id: "tcisediag_1", snapshotEntryId: "tcisentry_1", rowNumber: 1, phase: "MATCHING", code: "NO_CANDIDATE", severity: "WARNING", fieldRef: null, message: "No candidate variant found" },
  ],
  count: 1, limit: 20, offset: 0,
}

function renderPage(
  summaryOverrides: Partial<typeof BASE_SUMMARY> = {},
  extra: { entries?: { entries: Record<string, unknown>[]; count: number; limit: number; offset: number }; proposals?: unknown[]; thumbnails?: Record<string, unknown> } = {},
) {
  const summary = { ...BASE_SUMMARY, ...summaryOverrides }
  const entries = extra.entries ?? BASE_ENTRIES
  const proposals = extra.proposals ?? []
  const thumbnails = extra.thumbnails ?? {}
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method === "POST" && url.includes("/retry-matching")) {
      return mockResponse({ result: { kind: "IMPORTED", snapshotId: "tcisnap_1" } })
    }
    if (method === "POST" && url.includes("/reconcile")) {
      return mockResponse({ summary: { proposalCount: 1 } })
    }
    if (url.includes("/summary")) return mockResponse({ summary })
    if (url.includes("/entries")) return mockResponse(entries)
    if (url.includes("/diagnostics")) return mockResponse(BASE_DIAGNOSTICS)
    if (url.includes("/admin/trading-card-inventory/proposals")) return mockResponse({ proposals, count: proposals.length, limit: 100, offset: 0 })
    if (url.includes("/admin/trading-cards/variants/images")) return mockResponse({ thumbnails })
    if (url.includes("/admin/trading-cards/") && url.includes("/images")) return mockResponse({ trading_card: { id: "tcard_1", name: "Test", card_number: "1" }, card_set: { id: "s1", display_name: "Set", language: "EN" }, tcgdex_reference_artwork_url: null, variants: [] })
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
    expect(screen.getByText("VALIDATED")).toBeInTheDocument()
    expect(await screen.findByText("card:sv1|066/196|holo|nm")).toBeInTheDocument()
    expect(screen.getByText("GBP 1.50")).toBeInTheDocument()
    expect(screen.getByText("GBP 3.00")).toBeInTheDocument()
    expect(screen.getByText("GBP 4.00")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Diagnostics/ }))
    expect(await screen.findByText("No candidate variant found")).toBeInTheDocument()
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

  it("opens the replace-image dialog when a matched row's thumbnail is clicked", async () => {
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
    expect(await screen.findByText("Card photograph")).toBeInTheDocument()
  })

  it("opens the row detail drawer when a row is clicked", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("import.csv")

    await user.click(screen.getByText("card:sv1|066/196|holo|nm"))
    expect(await screen.findByText("Row 1")).toBeInTheDocument()
  })

  it("shows retry matching when rows are outstanding, and reconciliation only while VALIDATED", async () => {
    renderPage()
    await screen.findByText("import.csv")
    expect(screen.getByRole("button", { name: /Retry matching/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Trigger reconciliation" })).toBeInTheDocument()
  })

  it("hides both action buttons once nothing is outstanding and the snapshot is no longer VALIDATED", async () => {
    renderPage({ status: "PENDING_REVIEW", byMatchingStatus: { MATCHED: 2 } })
    await screen.findByText("import.csv")
    expect(screen.queryByRole("button", { name: /Retry matching/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Trigger reconciliation" })).not.toBeInTheDocument()
  })

  it("hides retry for a terminal snapshot even when rows remain outstanding", async () => {
    renderPage({ status: "FAILED" })
    await screen.findByText("import.csv")
    expect(screen.queryByRole("button", { name: /Retry matching/ })).not.toBeInTheDocument()
  })

  it("retries matching and shows a success toast", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findByText("import.csv")

    await user.click(screen.getByRole("button", { name: /Retry matching/ }))

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Matching was run again"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-card-inventory/imports/snapshots/tcisnap_1/retry-matching",
      expect.objectContaining({ method: "POST" })
    )
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

  it("re-fetches entries with the outcome filter applied", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
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
    await screen.findByText("No candidate variant found")
    fetchMock.mockClear()

    await user.click(screen.getAllByRole("button", { name: "1" })[0])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("snapshotEntryId=tcisentry_1"),
      { credentials: "include" },
    ))
  })
})
