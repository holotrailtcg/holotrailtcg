/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import ReplaceCardImageDialog from "../replace-card-image-dialog"
import type { CardImageDetail, CardImageDto } from "../image-types"

class FakeXhr {
  static instances: FakeXhr[] = []
  status = 200
  aborted = false
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  constructor() {
    FakeXhr.instances.push(this)
  }

  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    if (this.aborted) return
    this.aborted = true
    this.onabort?.()
  }
}

function fakeFile(name = "card.jpg", type = "image/jpeg", size = 1024): File {
  return { name, type, size } as unknown as File
}

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function existingImage(overrides: Partial<CardImageDto> = {}): CardImageDto {
  return {
    id: "tcimg_old", status: "READY", tradingCardVariantId: "tcvar_1", originalFilename: "old.jpg",
    confirmedMimeType: "image/jpeg", width: 800, height: 1000, sortOrder: 0, focalX: 0.5, focalY: 0.5,
    imageUrl: "https://images.example/old.jpg", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function detailWithExistingImage(): CardImageDetail {
  return {
    trading_card: { id: "tcard_1", name: "Gengar", card_number: "066/196" },
    card_set: { id: "tcset_1", display_name: "Lost Origin", language: "EN" },
    tcgdex_reference_artwork_url: null,
    variants: [{
      id: "tcvar_1", sku: "SKU-1", condition: "NEAR_MINT", finish: "HOLO", special_treatment: "NONE",
      ready_images: [existingImage()], archived_images: [],
    }],
  }
}

/** Drives ImageUploadQueue's real upload pipeline for the single in-flight file through to completion. */
async function driveUploadToReady() {
  await screen.findByText(/Uploading/)
  const xhr = FakeXhr.instances[FakeXhr.instances.length - 1]
  xhr.onload?.()
}

function renderDialog(fetchImpl: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => fetchImpl(String(input), init))
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = jest.fn()
  const onUploaded = jest.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <ReplaceCardImageDialog tradingCardId="tcard_1" tradingCardVariantId="tcvar_1" onClose={onClose} onUploaded={onUploaded} />
    </QueryClientProvider>
  )
  return { fetchMock, onClose, onUploaded }
}

describe("ReplaceCardImageDialog — replacement success only after archive succeeds (Codex remediation)", () => {
  beforeEach(() => {
    FakeXhr.instances = []
    ;(globalThis as unknown as { XMLHttpRequest: typeof FakeXhr }).XMLHttpRequest = FakeXhr
  })

  it("does not report success, surfaces the failure, and stays in replacement mode when archiving the old image fails", async () => {
    let detailCallCount = 0
    const { fetchMock, onUploaded } = renderDialog(async (url) => {
      if (url.includes("/images/upload")) {
        return mockResponse({
          uploadUrl: "https://fake-r2.invalid/key", objectKey: "key", imageId: "tcimg_new",
          expiresAt: "2026-01-01T00:00:00.000Z", requiredHeaders: {},
        }, 201)
      }
      if (url.includes("/images/tcimg_new/confirm")) {
        return mockResponse({ id: "tcimg_new", status: "READY" } satisfies Partial<CardImageDto>)
      }
      if (url.includes("/images/tcimg_old/archive")) {
        return mockResponse({ message: "Something went wrong" }, 500)
      }
      if (url.includes("/trading-cards/tcard_1/images")) {
        detailCallCount += 1
        return mockResponse(detailWithExistingImage())
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const user = userEvent.setup()
    await screen.findByText("Current image")
    const initialDetailCalls = detailCallCount
    await user.click(screen.getByRole("button", { name: "Replace image" }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, fakeFile())

    await driveUploadToReady()

    // The archive call failed — no success toast/text, error surfaced, and
    // the dialog must refresh from the server rather than trusting the
    // pre-archive-attempt local state.
    await screen.findByText(/could not be archived, so it is still the primary image/i)
    expect(screen.queryByText("Image saved.")).not.toBeInTheDocument()

    await waitFor(() => expect(detailCallCount).toBeGreaterThan(initialDetailCalls))

    // Still in replacement mode: the upload control remains available.
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument()

    // The parent's "thumbnail changed" callback must not fire on a failed replacement.
    expect(onUploaded).not.toHaveBeenCalled()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/images/tcimg_old/archive"), expect.anything())
  })

  it("reports success only after the old image is actually archived, and the new image becomes primary", async () => {
    let archived = false
    const { onUploaded } = renderDialog(async (url) => {
      if (url.includes("/images/upload")) {
        return mockResponse({
          uploadUrl: "https://fake-r2.invalid/key", objectKey: "key", imageId: "tcimg_new",
          expiresAt: "2026-01-01T00:00:00.000Z", requiredHeaders: {},
        }, 201)
      }
      if (url.includes("/images/tcimg_new/confirm")) {
        return mockResponse({ id: "tcimg_new", status: "READY" } satisfies Partial<CardImageDto>)
      }
      if (url.includes("/images/tcimg_old/archive")) {
        archived = true
        return mockResponse({ id: "tcimg_old", status: "ARCHIVED" })
      }
      if (url.includes("/trading-cards/tcard_1/images")) {
        // Mirrors the server's real post-archive state: the old image is
        // gone from the ready set and the new upload has taken its place as
        // primary — proving the dialog's "success" reflects server-refreshed
        // state, not an optimistic local assumption.
        const detail = detailWithExistingImage()
        if (archived) {
          detail.variants[0].ready_images = [existingImage({
            id: "tcimg_new", originalFilename: "new.jpg", imageUrl: "https://images.example/new.jpg", sortOrder: 0,
          })]
        }
        return mockResponse(detail)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const user = userEvent.setup()
    await screen.findByText("Current image")
    await user.click(screen.getByRole("button", { name: "Replace image" }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, fakeFile())

    await driveUploadToReady()

    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    // The dialog settles back on the "current image" view showing the new photo as primary.
    await screen.findByAltText("new.jpg")
  })
})
