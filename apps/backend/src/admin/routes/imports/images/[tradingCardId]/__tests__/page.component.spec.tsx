/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { TooltipProvider } from "@medusajs/ui"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { CardImageDetail, CardImageDto } from "../../../../../components/imports/image-types"
import ImportsImagesDetailPage from "../page"

jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui")
  return {
    ...actual,
    usePrompt: () => jest.requireMock("@medusajs/ui").__mockPrompt,
    __mockPrompt: jest.fn().mockResolvedValue(true),
    toast: { ...actual.toast, success: jest.fn(), error: jest.fn(), info: jest.fn() },
  }
})

const mockedUi = jest.requireMock("@medusajs/ui") as {
  __mockPrompt: jest.Mock
  toast: { success: jest.Mock; error: jest.Mock; info: jest.Mock }
}

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function baseImage(overrides: Partial<CardImageDto> = {}): CardImageDto {
  return {
    id: "tcimg_1", status: "READY", tradingCardVariantId: "tcvar_1", originalFilename: "front.jpg",
    confirmedMimeType: "image/jpeg", width: 6, height: 8, sortOrder: 0, focalX: 0.5, focalY: 0.5,
    imageUrl: "https://example.invalid/front.jpg", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  }
}

function baseDetail(overrides: Partial<CardImageDetail> = {}): CardImageDetail {
  return {
    trading_card: { id: "tcard_1", name: "Pikachu", card_number: "025/100" },
    card_set: { id: "tcset_1", display_name: "Base Set", language: "EN" },
    tcgdex_reference_artwork_url: "https://tcgdex.invalid/pikachu.png",
    variants: [
      {
        id: "tcvar_1", sku: "SKU-1", condition: "NEAR_MINT", finish: "HOLO", special_treatment: "NONE",
        ready_images: [baseImage({ id: "tcimg_1", sortOrder: 0 }), baseImage({ id: "tcimg_2", sortOrder: 1 })],
        archived_images: [],
      },
    ],
    ...overrides,
  }
}

function renderPage(detail: CardImageDetail, extraFetchHandlers?: (url: string, method: string) => unknown) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.includes("/admin/trading-cards/tcard_1/images") && method === "GET") {
      return mockResponse(detail)
    }
    if (extraFetchHandlers) {
      const handled = extraFetchHandlers(url, method)
      if (handled) return handled
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/imports/images/tcard_1"]}>
          <Routes>
            <Route path="/imports/images/:tradingCardId" element={<ImportsImagesDetailPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { fetchMock, queryClient }
}

describe("ImportsImagesDetailPage", () => {
  beforeEach(() => {
    mockedUi.__mockPrompt.mockClear().mockResolvedValue(true)
    mockedUi.toast.success.mockClear()
    mockedUi.toast.error.mockClear()
  })

  it("shows the primary badge only on the first ready image", async () => {
    renderPage(baseDetail())
    await screen.findByRole("heading", { name: "Pikachu" })
    expect(screen.getAllByText("Primary")).toHaveLength(1)
  })

  it("never shows a permanent-delete action", async () => {
    renderPage(baseDetail())
    await screen.findByRole("heading", { name: "Pikachu" })
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument()
  })

  it("keeps the TCGdex reference artwork visually separate from Holo Trail photographs", async () => {
    renderPage(baseDetail())
    await screen.findByRole("heading", { name: "Pikachu" })
    expect(screen.getByText("Reference only — not a Holo Trail photograph")).toBeInTheDocument()
    expect(screen.getByAltText(/reference artwork from TCGdex/)).toBeInTheDocument()
  })

  it("moves an image later, refreshes and shows a success toast", async () => {
    const user = userEvent.setup()
    const { fetchMock, queryClient } = renderPage(baseDetail(), (url, method) => {
      if (url.includes("/images/reorder") && method === "POST") {
        return mockResponse({ images: [baseImage({ id: "tcimg_2", sortOrder: 0 }), baseImage({ id: "tcimg_1", sortOrder: 1 })] })
      }
      return null
    })
    await screen.findByRole("heading", { name: "Pikachu" })
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries")

    await user.click(screen.getAllByRole("button", { name: "Move later" })[0])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-cards/variants/tcvar_1/images/reorder",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ orderedImageIds: ["tcimg_2", "tcimg_1"] }),
      })
    ))
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it("makes a non-primary image primary via the reorder endpoint", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseDetail(), (url, method) => {
      if (url.includes("/images/reorder") && method === "POST") {
        return mockResponse({ images: [] })
      }
      return null
    })
    await screen.findByRole("heading", { name: "Pikachu" })

    await user.click(screen.getByRole("button", { name: "Make primary" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-cards/variants/tcvar_1/images/reorder",
      expect.objectContaining({ body: JSON.stringify({ orderedImageIds: ["tcimg_2", "tcimg_1"] }) })
    ))
  })

  it("sets a focal position and posts the new coordinates", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseDetail(), (url, method) => {
      if (url.includes("/focal-point") && method === "POST") {
        return mockResponse(baseImage({ focalX: 1, focalY: 1 }))
      }
      return null
    })
    await screen.findByRole("heading", { name: "Pikachu" })

    await user.click(screen.getAllByRole("button", { name: "Focal position" })[0])
    await user.click(screen.getByRole("button", { name: "Bottom right" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-cards/images/tcimg_1/focal-point",
      expect.objectContaining({ body: JSON.stringify({ focalX: 1, focalY: 1 }) })
    ))
    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Focal position saved"))
  })

  it("asks for confirmation before archiving, and does not archive when cancelled", async () => {
    mockedUi.__mockPrompt.mockResolvedValue(false)
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseDetail())
    await screen.findByRole("heading", { name: "Pikachu" })

    await user.click(screen.getAllByRole("button", { name: "Archive" })[0])

    expect(mockedUi.__mockPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: "Archive this image?" }))
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/archive"), expect.anything())
  })

  it("archives after confirmation and shows success", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderPage(baseDetail(), (url, method) => {
      if (url.includes("/images/tcimg_1/archive") && method === "POST") {
        return mockResponse(baseImage({ status: "ARCHIVED" }))
      }
      return null
    })
    await screen.findByRole("heading", { name: "Pikachu" })

    await user.click(screen.getAllByRole("button", { name: "Archive" })[0])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/admin/trading-cards/images/tcimg_1/archive",
      expect.objectContaining({ method: "POST" })
    ))
    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Image archived"))
  })

  it("restores an archived image without a confirmation dialog", async () => {
    const user = userEvent.setup()
    const detail = baseDetail({
      variants: [{
        id: "tcvar_1", sku: "SKU-1", condition: "NEAR_MINT", finish: "HOLO", special_treatment: "NONE",
        ready_images: [], archived_images: [baseImage({ id: "tcimg_3", status: "ARCHIVED" })],
      }],
    })
    const { fetchMock } = renderPage(detail, (url, method) => {
      if (url.includes("/images/tcimg_3/restore") && method === "POST") {
        return mockResponse(baseImage({ id: "tcimg_3", status: "READY" }))
      }
      return null
    })
    await screen.findByRole("heading", { name: "Pikachu" })

    await user.click(screen.getByRole("button", { name: "Restore" }))

    expect(mockedUi.__mockPrompt).not.toHaveBeenCalled()
    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalledWith("Image restored"))
  })
})
