/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { TooltipProvider } from "@medusajs/ui"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { ReviewDetail } from "../../../../../components/imports/types"
import ImportsReviewDetailPage from "../page"

// The mock spies are created entirely inside this factory (nothing from
// module scope is captured) because @swc/jest hoists `jest.mock` calls
// above the file's top-level `const` declarations without honouring the
// "mock"-prefix escape hatch babel-jest supports, so any outer const would
// be read before initialisation. Tests reach the spies through the mocked
// module's own exports instead.
jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui")
  return {
    ...actual,
    usePrompt: () => jest.requireMock("@medusajs/ui").__mockPrompt,
    __mockPrompt: jest.fn().mockResolvedValue(true),
    toast: { ...actual.toast, success: jest.fn(), error: jest.fn(), info: jest.fn() },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedUi = jest.requireMock("@medusajs/ui") as {
  __mockPrompt: jest.Mock
  toast: { success: jest.Mock; error: jest.Mock; info: jest.Mock }
}

function baseReview(overrides: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    proposal: { id: "tcep_1", provider: "TCGDEX", provider_card_id: "provider-card", provider_set_id: "provider-set" },
    trading_card: {
      id: "tcard_1", name: "Pikachu", card_number: "025/100", search_name: "pikachu",
      rarity_raw: null, rarity: null,
    },
    card_set: {
      id: "tcset_1", display_name: "Base Set", provider_set_code: "base1", language: "EN",
      game: "POKEMON", release_date: null,
    },
    snapshot: {
      provider: "TCGDEX", providerCardId: "provider-card", providerSetId: "provider-set",
      name: "Pikachu", localId: "025", category: "Pokemon",
      variants: { normal: true, reverse: false, holo: false, firstEdition: false },
    },
    review_status: "PENDING",
    match_source: "AUTOMATIC",
    reviewer_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    reviewed_at: null,
    applied_at: null,
    audit_history: [],
    ...overrides,
  }
}

/**
 * A plain Fetch-Response-shaped object, not a real `Response` instance:
 * jsdom (unlike Node itself) exposes no `fetch`/`Response` globals, and
 * `page.tsx` only ever reads `.ok` and calls `.json()`.
 */
function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderPage(review: ReviewDetail) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/admin/tcgdex/reviews/tcep_1") && !url.includes("/approve") && !url.includes("/reject") && !url.includes("/apply")) {
      return mockResponse({ review })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/imports/review/tcep_1"]}>
          <Routes>
            <Route path="/imports/review/:proposalId" element={<ImportsReviewDetailPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { fetchMock, queryClient }
}

describe("ImportsReviewDetailPage actions", () => {
  beforeEach(() => {
    mockedUi.__mockPrompt.mockClear().mockResolvedValue(true)
    mockedUi.toast.success.mockClear()
    mockedUi.toast.error.mockClear()
    mockedUi.toast.info.mockClear()
  })

  it("shows Approve, Reject and Retry, but not Apply, while pending", async () => {
    renderPage(baseReview({ review_status: "PENDING" }))
    await screen.findByRole("heading", { name: "Pikachu" })
    const actions = screen.getByText("Try TCGdex again").closest("div") as HTMLElement
    expect(within(actions).getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(within(actions).getByRole("button", { name: "Reject" })).toBeInTheDocument()
    expect(within(actions).queryByRole("button", { name: "Apply" })).not.toBeInTheDocument()
  })

  it("shows Apply and Retry, but not Approve or Reject, once approved", async () => {
    renderPage(baseReview({ review_status: "APPROVED" }))
    await screen.findByRole("heading", { name: "Pikachu" })
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try TCGdex again" })).toBeInTheDocument()
  })

  it("shows only Retry once superseded", async () => {
    renderPage(baseReview({ review_status: "SUPERSEDED" }))
    await screen.findByRole("heading", { name: "Pikachu" })
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Try TCGdex again" })).not.toBeInTheDocument()
  })

  it("keeps Ignore disabled and labelled as not connected", async () => {
    renderPage(baseReview({ review_status: "PENDING" }))
    await screen.findByRole("heading", { name: "Pikachu" })
    expect(screen.getByRole("button", { name: "Ignore" })).toBeDisabled()
  })

  it("approves without a confirmation dialog, refreshes, and shows success", async () => {
    const user = userEvent.setup()
    const { fetchMock, queryClient } = renderPage(baseReview({ review_status: "PENDING" }))
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries")
    await screen.findByRole("heading", { name: "Pikachu" })

    fetchMock.mockImplementationOnce(async () => mockResponse({ review: baseReview({ review_status: "APPROVED" }) }))

    await user.click(screen.getByRole("button", { name: "Approve" }))

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Match approved"))
    expect(mockedUi.__mockPrompt).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/tcgdex/reviews/tcep_1/approve",
      expect.objectContaining({ method: "POST" })
    )
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it("shows a confirmation dialog before rejecting, and a safe error toast on failure", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseReview({ review_status: "PENDING" }))
    await screen.findByRole("heading", { name: "Pikachu" })

    fetchMock.mockImplementationOnce(async () => mockResponse({ message: "internal database detail" }, 500))

    await user.click(screen.getByRole("button", { name: "Reject" }))

    expect(mockedUi.__mockPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: "Reject this match?" }))
    await waitFor(() => expect(mockedUi.toast.error).toHaveBeenCalledWith("This match could not be rejected. Please try again."))
    expect(mockedUi.toast.error.mock.calls[0][0]).not.toMatch(/internal database detail/)
  })

  it("does not reject when the confirmation dialog is cancelled", async () => {
    mockedUi.__mockPrompt.mockResolvedValue(false)
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseReview({ review_status: "PENDING" }))
    await screen.findByRole("heading", { name: "Pikachu" })
    fetchMock.mockClear()

    await user.click(screen.getByRole("button", { name: "Reject" }))

    expect(mockedUi.__mockPrompt).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/reject"),
      expect.anything()
    )
  })

  it("shows a confirmation dialog before applying", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseReview({ review_status: "APPROVED" }))
    await screen.findByRole("heading", { name: "Pikachu" })

    fetchMock.mockImplementationOnce(async () => mockResponse({ review: baseReview({ review_status: "APPLIED" }) }))

    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(mockedUi.__mockPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: "Apply these card details?" }))
    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Card details applied"))
  })

  it("retries without a confirmation dialog and shows the match outcome", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseReview({ review_status: "PENDING" }))
    await screen.findByRole("heading", { name: "Pikachu" })

    fetchMock.mockImplementationOnce(async () => mockResponse({ outcome: "NO_MATCH", attempt: { id: "tcea_1" } }))

    await user.click(screen.getByRole("button", { name: "Try TCGdex again" }))

    expect(mockedUi.__mockPrompt).not.toHaveBeenCalled()
    await waitFor(() => expect(mockedUi.toast.info).toHaveBeenCalledWith("TCGdex could not find this card."))
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/tcgdex/cards/tcard_1/retry",
      expect.objectContaining({ method: "POST" })
    )
  })
})
