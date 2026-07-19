/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { TooltipProvider } from "@medusajs/ui"
import InventoryProposalsPage from "../page"

jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui")
  return {
    ...actual,
    toast: { ...actual.toast, success: jest.fn(), error: jest.fn(), info: jest.fn() },
    usePrompt: () => jest.fn().mockResolvedValue(true),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedUi = jest.requireMock("@medusajs/ui") as { toast: { success: jest.Mock; error: jest.Mock; info: jest.Mock } }

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const BASE_PROGRESS = {
  totalProposals: 2, pending: 1, approved: 1, rejected: 0, appliedFullySynced: 0, appliedSyncPending: 0,
  appliedSyncFailed: 0, blocked: 0, outOfScope: 0, allReviewed: false, allApplicableApplied: false, fullyComplete: false,
}

const PENDING_PROPOSAL = {
  id: "tciprop_1", inventorySourceId: "tcisrc_1", inventorySnapshotId: "tcisnap_1",
  tradingCardVariantId: "tcvar_1", providerReference: "ref-1", previousQuantity: 0, proposedQuantity: 5,
  quantityDelta: 5, changeKind: "NEW_HOLDING", reviewStatus: "PENDING", resolvedBy: null, resolvedAt: null,
  reviewNote: null, appliedAt: null, appliedTransactionId: null, medusaSyncStatus: "NOT_APPLICABLE",
  medusaInventoryItemId: null, medusaStockLocationId: null, medusaSyncRetryCount: 0, medusaSyncLastError: null,
  createdAt: "2026-07-01T00:00:00.000Z",
}

const APPROVED_PROPOSAL = {
  ...PENDING_PROPOSAL, id: "tciprop_2", reviewStatus: "APPROVED", resolvedBy: "reviewer", resolvedAt: "2026-07-01T00:00:00.000Z",
}

const READY_IMAGE_READINESS = { ready: true, totalMatchedCards: 1, cardsWithPhoto: 1 }

function renderPage(
  proposals = [PENDING_PROPOSAL, APPROVED_PROPOSAL],
  overrides: {
    progress?: Partial<typeof BASE_PROGRESS>
    imageReadiness?: typeof READY_IMAGE_READINESS
    thumbnails?: Record<string, unknown>
  } = {},
) {
  const progress = { ...BASE_PROGRESS, ...overrides.progress }
  const imageReadiness = overrides.imageReadiness ?? READY_IMAGE_READINESS
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method === "POST" && url.includes("/proposals/tciprop_1/review")) {
      return mockResponse({ proposal: { ...PENDING_PROPOSAL, reviewStatus: "APPROVED" } })
    }
    if (method === "POST" && url.includes("/proposals/review")) {
      return mockResponse({ proposals: proposals.map((p) => ({ ...p, reviewStatus: "APPROVED" })) })
    }
    if (method === "POST" && url.includes("/apply")) {
      return mockResponse({ result: { proposalId: "tciprop_2", localApplicationStatus: "APPLIED", transactionId: "tcitxn_1", priorQuantity: 0, resultingQuantity: 5, medusaSyncStatus: "SYNCED", errorCode: null, errorMessage: null } })
    }
    if (url.includes("/summary")) return mockResponse({ summary: { inventorySourceId: "tcisrc_1" }, progress, imageReadiness })
    if (url.includes("/variants/images?")) return mockResponse({ thumbnails: overrides.thumbnails ?? {} })
    if (url.includes("/entries?")) {
      const proposal = proposals[0]
      const proposalCard = proposal as typeof proposal & { card?: unknown; cardIdentityHint?: string | null }
      return mockResponse({
        entries: [{
          id: "entry_1", rowNumber: 1, providerReference: proposal.providerReference, quantity: proposal.proposedQuantity ?? 1,
          currencyCode: "GBP", unitAcquisitionCost: "0", unitMarketPrice: "1", unitSellingPrice: "2",
          conditionSource: null, conditionCandidate: "NEAR_MINT", finishCandidate: "REVERSE_HOLO",
          specialTreatmentCandidate: null, rarityCandidate: "COMMON", rarityRaw: "Common", languageConflict: false,
          outcome: "VALID", tradingCardVariantId: proposal.tradingCardVariantId, matchingStatus: "MATCHED", matchedVia: "TCGDEX",
          retryCount: 0, card: proposalCard.card ?? null, cardIdentityHint: proposalCard.cardIdentityHint ?? null, tcgdexCandidate: null,
        }],
        count: 1, limit: 1, offset: 0,
      })
    }
    if (url.includes("/diagnostics?")) return mockResponse({ diagnostics: [], count: 0, limit: 50, offset: 0 })
    if (url.includes("/admin/trading-cards/") && url.endsWith("/images")) {
      return mockResponse({ trading_card: { id: "tcard_1", name: "Pikachu", card_number: "025/100" }, card_set: { id: "set_1", display_name: "Base Set", language: "EN" }, tcgdex_reference_artwork_url: null, variants: [] })
    }
    if (url.includes("/proposals?")) return mockResponse({ proposals, count: proposals.length, limit: 20, offset: 0 })
    if (url.match(/\/proposals\/tciprop_\d$/)) return mockResponse({ proposal: proposals[0], history: [] })
    throw new Error(`Unexpected fetch: ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/imports/snapshots/tcisnap_1/proposals"]}>
          <Routes>
            <Route path="/imports/snapshots/:id/proposals" element={<InventoryProposalsPage />} />
            <Route path="/imports/snapshots/:id" element={<div>Snapshot detail (redirected here)</div>} />
            <Route path="/imports/images" element={<div>Assign card images (redirected here)</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { fetchMock }
}

describe("InventoryProposalsPage", () => {
  beforeEach(() => {
    mockedUi.toast.success.mockClear()
    mockedUi.toast.error.mockClear()
    mockedUi.toast.info.mockClear()
  })

  it("renders proposals with combined status badges and progress counts", async () => {
    renderPage()
    expect(await screen.findByText("Pending review")).toBeInTheDocument()
    expect(screen.getByText("Approved — not yet applied")).toBeInTheDocument()
    expect(screen.getByText("Pending 1")).toBeInTheDocument()
    expect(screen.getByText("Approved, unapplied 1")).toBeInTheDocument()
  })

  it("redirects to Assign card images when any matched card still needs a photograph", async () => {
    renderPage([PENDING_PROPOSAL, APPROVED_PROPOSAL], {
      imageReadiness: { ready: false, totalMatchedCards: 1, cardsWithPhoto: 0 },
    })
    expect(await screen.findByText("Assign card images (redirected here)")).toBeInTheDocument()
  })

  it("shows uploaded and TCGDex image columns and opens the row detail drawer", async () => {
    const user = userEvent.setup()
    const proposal = {
      ...PENDING_PROPOSAL,
      card: {
        tradingCardId: "tcard_1", name: "Pikachu", setDisplayName: "Base Set", cardNumber: "025/100",
        rarity: "COMMON", rarityRaw: "Common", condition: "NEAR_MINT", finish: "REVERSE_HOLO", specialTreatment: "NONE", sku: "PIKA",
      },
    }
    renderPage([proposal], {
      thumbnails: {
        tcvar_1: {
          tradingCardId: "tcard_1", imageUrl: "https://images.example/uploaded.jpg", source: "PHOTO",
          photoUrl: "https://images.example/uploaded.jpg", tcgdexImageUrl: "https://assets.tcgdex.net/pikachu.webp",
        },
      },
    })

    expect(await screen.findByRole("columnheader", { name: "Uploaded image" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "TCGDex image" })).toBeInTheDocument()
    expect(await screen.findByRole("img", { name: "Uploaded image for Pikachu" })).toHaveAttribute("src", "https://images.example/uploaded.jpg")
    expect(screen.getByRole("img", { name: "TCGDex image for Pikachu" })).toHaveAttribute("src", "https://assets.tcgdex.net/pikachu.webp")

    await user.click(screen.getByText("Pikachu"))
    expect(await screen.findByText("Import row 1")).toBeInTheDocument()
  })

  it("approves a single pending proposal", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findByText("Pending review")

    await user.click(screen.getByRole("button", { name: "Approve" }))

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Review saved"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-card-inventory/proposals/tciprop_1/review",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ targetStatus: "APPROVED" }) })
    )
  })

  it("applies a single approved proposal", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findByText("Approved — not yet applied")

    await user.click(screen.getByRole("button", { name: "Apply" }))

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Applied and synced to Medusa"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-card-inventory/proposals/tciprop_2/apply",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("selects rows and bulk-approves them", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findByText("Pending review")

    const checkboxes = screen.getAllByRole("checkbox")
    await user.click(checkboxes[0])
    expect(checkboxes[1]).not.toBeDisabled()
    expect(await screen.findByText("1 selected")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Approve selected" }))

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Selected proposals were reviewed"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-card-inventory/proposals/review",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ids: ["tciprop_1"], targetStatus: "APPROVED" }),
      })
    )
  })

  it("does not offer apply or bulk selection for out-of-scope approved proposals", async () => {
    const outOfScope = { ...APPROVED_PROPOSAL, changeKind: "PRICE_CHANGE" }
    renderPage([outOfScope])
    await screen.findByRole("checkbox")
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument()
    expect(screen.getByRole("checkbox")).toBeDisabled()
  })

  it("shows a retry-sync action only for an applied proposal with a failed Medusa sync", async () => {
    const failedSyncProposal = { ...APPROVED_PROPOSAL, id: "tciprop_3", reviewStatus: "APPLIED", medusaSyncStatus: "FAILED" }
    renderPage([failedSyncProposal])
    expect(await screen.findByText("Inventory applied — Medusa sync failed")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument()
  })

  it("expands and collapses the history panel for a proposal", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Pending review")

    await user.click(screen.getAllByRole("button", { name: "History" })[0])
    expect(await screen.findByText(/History for tciprop_1/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Hide history" }))
    expect(screen.queryByText(/History for tciprop_1/)).not.toBeInTheDocument()
  })
})
