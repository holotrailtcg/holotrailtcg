/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { TooltipProvider } from "@medusajs/ui"
import InventoryProposalsPage from "../page"
import type { InventoryProposalListItem } from "../../../../../../components/imports/pulse-import-types"

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

const PENDING_PROPOSAL: InventoryProposalListItem = {
  id: "tciprop_1", inventorySourceId: "tcisrc_1", inventorySnapshotId: "tcisnap_1",
  tradingCardVariantId: "tcvar_1",
  card: {
    tradingCardId: "tcard_1", name: "Pikachu", setDisplayName: "Base Set", cardNumber: "025/100",
    rarity: "COMMON", rarityRaw: "Common", condition: "NEAR_MINT", finish: "REVERSE_HOLO", specialTreatment: "NONE", sku: "PIKA-025",
  },
  cardIdentityHint: null, providerReference: "ref-1", previousQuantity: 0, proposedQuantity: 5,
  quantityDelta: 5, changeKind: "NEW_HOLDING", reviewStatus: "PENDING", resolvedBy: null, resolvedAt: null,
  reviewNote: null, appliedAt: null, appliedTransactionId: null, medusaSyncStatus: "NOT_APPLICABLE",
  medusaInventoryItemId: null, medusaStockLocationId: null, medusaSyncRetryCount: 0, medusaSyncLastError: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  // A NEW_HOLDING proposal needs a reviewer-confirmed eBay Store category
  // before it is eligible for Apply (see `needsCategoryConfirmation` in the
  // page under test) — most fixtures here are already past that gate.
  proposedEbayStoreCategoryId: null, proposedCategoryReason: null, proposedCategoryRuleId: null,
  confirmedEbayStoreCategoryId: "ebcat_1", categoryConfirmedAt: "2026-07-01T00:00:00.000Z", categoryConfirmedBy: "reviewer",
}

const APPROVED_PROPOSAL = {
  ...PENDING_PROPOSAL, id: "tciprop_2", reviewStatus: "APPROVED", resolvedBy: "reviewer", resolvedAt: "2026-07-01T00:00:00.000Z",
}

const READY_IMAGE_READINESS = { ready: true, totalMatchedCards: 1, cardsWithPhoto: 1 }

function renderPage(
  proposals: InventoryProposalListItem[] = [PENDING_PROPOSAL, APPROVED_PROPOSAL],
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
    if (method === "POST" && url.includes("/category")) {
      const match = url.match(/\/proposals\/(tciprop_\d+)\/category/)
      const id = match?.[1]
      const target = proposals.find((p) => p.id === id)
      if (target) target.confirmedEbayStoreCategoryId = "ebcat_1"
      return mockResponse({ proposal: { ...target, confirmedEbayStoreCategoryId: "ebcat_1" } })
    }
    if (url.includes("/admin/ebay/store-categories")) {
      return mockResponse({
        accountId: "acct_1",
        categories: [{ id: "ebcat_1", externalId: "1", name: "Pokemon", parentExternalId: null, siblingOrder: 1, level: 1, path: "Pokemon", status: "ACTIVE" }],
      })
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
    if (url.match(/\/proposals\/tciprop_\d+$/)) {
      const match = url.match(/\/proposals\/(tciprop_\d+)$/)
      const target = proposals.find((p) => p.id === match?.[1]) ?? proposals[0]
      const history = target?.id === "tciprop_1" ? [{
        id: "tciaudit_1", actor: "system:category-rule-auto-confirm", action: "PROPOSAL_CATEGORY_CONFIRMED",
        oldValue: null, newValue: null, reason: null, source: "SYSTEM", createdAt: "2026-07-01T00:00:00.000Z",
      }] : []
      return mockResponse({ proposal: target, history })
    }
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

  it("renders proposals with quantity-change badges and progress counts", async () => {
    renderPage()
    expect(await screen.findAllByText("Pikachu")).toHaveLength(2)
    // PENDING_PROPOSAL/APPROVED_PROPOSAL both go 0 -> 5, an increase, so both badges are green.
    expect(screen.getAllByText("0 → 5")).toHaveLength(2)
    expect(screen.getByText("Pending 1")).toBeInTheDocument()
    expect(screen.getByText("Approved, unapplied 1")).toBeInTheDocument()
  })

  it("redirects to Assign card images when any matched card still needs a photograph", async () => {
    renderPage([PENDING_PROPOSAL, APPROVED_PROPOSAL], {
      imageReadiness: { ready: false, totalMatchedCards: 1, cardsWithPhoto: 0 },
    })
    expect(await screen.findByText("Assign card images (redirected here)")).toBeInTheDocument()
  })

  it("shows the uploaded-image column and opens the row detail drawer", async () => {
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

    expect(await screen.findByRole("columnheader", { name: "Card" })).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "TCGDex image" })).not.toBeInTheDocument()
    expect(await screen.findByRole("img", { name: "Uploaded image for Pikachu" })).toHaveAttribute("src", "https://images.example/uploaded.jpg")

    await user.click(screen.getByText("Pikachu"))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("approves a single pending proposal", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage()
    await screen.findAllByText("Pikachu")

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
    await screen.findByRole("button", { name: "Apply" })

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
    await screen.findAllByText("Pikachu")

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
    const failedSyncProposal: InventoryProposalListItem = { ...APPROVED_PROPOSAL, id: "tciprop_3", reviewStatus: "APPLIED", medusaSyncStatus: "FAILED" }
    renderPage([failedSyncProposal])
    expect(await screen.findByRole("button", { name: "Retry sync" })).toBeInTheDocument()
  })

  it("does not offer Apply for an approved NEW_HOLDING proposal without a confirmed eBay Store category", async () => {
    const unconfirmedApproved = { ...APPROVED_PROPOSAL, confirmedEbayStoreCategoryId: null, categoryConfirmedAt: null, categoryConfirmedBy: null }
    renderPage([unconfirmedApproved])
    await screen.findByText("Confirm the eBay category before this can be applied")

    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument()
    // Also excluded from bulk-select — selectionKind is null for it.
    expect(screen.getByRole("checkbox")).toBeDisabled()
  })

  it("offers Apply for an approved NEW_HOLDING proposal once its eBay Store category is confirmed", async () => {
    renderPage([APPROVED_PROPOSAL])

    expect(await screen.findByRole("button", { name: "Apply" })).toBeInTheDocument()
    expect(screen.queryByText("Confirm the eBay category before this can be applied")).not.toBeInTheDocument()
  })

  it("navigates to Inventory via 'View in Inventory →' once the snapshot is fully applied, not the Assign card images link", async () => {
    const user = userEvent.setup()
    renderPage([APPROVED_PROPOSAL], { progress: { fullyComplete: true, allApplicableApplied: true, allReviewed: true } })
    await screen.findByText("Import status: Complete")

    const viewInInventory = screen.getByRole("button", { name: "View in Inventory →" })
    expect(viewInInventory).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Next: Assign card images/ })).not.toBeInTheDocument()

    await user.click(viewInInventory)
    // No route for /inventory is mounted in this test harness, so a
    // successful navigation away is observed as this page's own content
    // disappearing rather than by asserting on the (unmounted) destination.
    await waitFor(() => expect(screen.queryByText("Import status: Complete")).not.toBeInTheDocument())
  })

  it("auto-advances the category dialog's 'Next card →' to the next row still needing category confirmation", async () => {
    const user = userEvent.setup()
    const firstNeedsCategory = {
      ...PENDING_PROPOSAL, id: "tciprop_1", changeKind: "NEW_HOLDING",
      proposedEbayStoreCategoryId: "ebcat_1", confirmedEbayStoreCategoryId: null,
    }
    const secondNeedsCategory = {
      ...PENDING_PROPOSAL, id: "tciprop_2", changeKind: "NEW_HOLDING",
      proposedEbayStoreCategoryId: "ebcat_1", confirmedEbayStoreCategoryId: null,
    }
    const { fetchMock } = renderPage([firstNeedsCategory, secondNeedsCategory])
    await screen.findAllByRole("button", { name: "Review proposed category" })

    await user.click(screen.getAllByRole("button", { name: "Review proposed category" })[0])
    await screen.findByRole("dialog")
    expect(await screen.findByRole("button", { name: "Next card →" })).toBeEnabled()

    await user.click(screen.getByRole("button", { name: "Next card →" }))

    // The dialog is remounted (keyed by proposal id) and re-fetches for the
    // next proposal — still open, now scoped to tciprop_2.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/proposals/tciprop_2"),
      expect.anything(),
    ))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("shows a readable (non-enum) history entry in the drawer, collapsed by default", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText("Pikachu")

    await user.click(screen.getAllByText("Pikachu")[0])
    const drawer = await screen.findByRole("dialog")
    const historyToggle = within(drawer).getByRole("button", { name: "History" })
    expect(within(drawer).queryByText(/Proposal Category Confirmed/)).not.toBeInTheDocument()

    await user.click(historyToggle)
    expect(await within(drawer).findByText(/Proposal Category Confirmed/)).toBeInTheDocument()
    expect(within(drawer).getByText(/System \(Category Rule Auto Confirm\)/)).toBeInTheDocument()
    expect(within(drawer).queryByText("PROPOSAL_CATEGORY_CONFIRMED")).not.toBeInTheDocument()

    await user.click(historyToggle)
    expect(within(drawer).queryByText(/Proposal Category Confirmed/)).not.toBeInTheDocument()
  })
})
