/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
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
    { id: "tcisediag_1", rowNumber: 1, phase: "MATCHING", code: "NO_CANDIDATE", severity: "WARNING", fieldRef: null, message: "No candidate variant found" },
  ],
  count: 1, limit: 20, offset: 0,
}

function renderPage(summaryOverrides: Partial<typeof BASE_SUMMARY> = {}) {
  const summary = { ...BASE_SUMMARY, ...summaryOverrides }
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
    if (url.includes("/entries")) return mockResponse(BASE_ENTRIES)
    if (url.includes("/diagnostics")) return mockResponse(BASE_DIAGNOSTICS)
    throw new Error(`Unexpected fetch: ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/imports/snapshots/tcisnap_1"]}>
        <Routes>
          <Route path="/imports/snapshots/:id" element={<ImportsSnapshotDetailPage />} />
        </Routes>
      </MemoryRouter>
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
    renderPage()
    await screen.findByText("import.csv")
    expect(screen.getByText("VALIDATED")).toBeInTheDocument()
    expect(await screen.findByText("card:sv1|066/196|holo|nm")).toBeInTheDocument()
    expect(await screen.findByText("No candidate variant found")).toBeInTheDocument()
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
})
