/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { ImageListResponse } from "../../../../components/imports/image-types"
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

function renderPage(fetchImpl: (url: string) => Promise<unknown>) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => fetchImpl(String(input)))
  global.fetch = fetchMock as unknown as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ImportsImagesPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { fetchMock }
}

describe("ImportsImagesPage", () => {
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
})
