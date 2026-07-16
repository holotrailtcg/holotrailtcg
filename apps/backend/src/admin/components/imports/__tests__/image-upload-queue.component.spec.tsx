/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import ImageUploadQueue from "../image-upload-queue"
import type { CardImageDto } from "../image-types"

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

/** Resolves `/images/upload` and `/confirm` immediately for any imageId, so multi-file batches don't need per-file wiring. */
function autoUploadFetchMock(imageIdFor: (index: number) => string) {
  let uploadCallIndex = 0
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/images/upload")) {
      const imageId = imageIdFor(uploadCallIndex)
      uploadCallIndex += 1
      return mockResponse({
        uploadUrl: `https://fake-r2.invalid/${imageId}`, objectKey: imageId, imageId,
        expiresAt: "2026-01-01T00:00:00.000Z", requiredHeaders: {},
      }, 201)
    }
    const confirmMatch = url.match(/\/images\/(.+)\/confirm/)
    if (confirmMatch) {
      return mockResponse({ id: confirmMatch[1], status: "READY" } satisfies Partial<CardImageDto>)
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe("ImageUploadQueue", () => {
  beforeEach(() => {
    FakeXhr.instances = []
    ;(global as unknown as { XMLHttpRequest: typeof FakeXhr }).XMLHttpRequest = FakeXhr
  })

  it("uploads a file end-to-end and reports success", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/images/upload")) {
        return mockResponse({
          uploadUrl: "https://fake-r2.invalid/key", objectKey: "key", imageId: "tcimg_1",
          expiresAt: "2026-01-01T00:00:00.000Z", requiredHeaders: { "Content-Type": "image/jpeg" },
        }, 201)
      }
      if (url.includes("/images/tcimg_1/confirm")) {
        return mockResponse({ id: "tcimg_1", status: "READY" } satisfies Partial<CardImageDto>)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const onUploaded = jest.fn()
    render(<ImageUploadQueue variantId="tcvar_1" files={[fakeFile()]} onUploaded={onUploaded} />)

    await screen.findByText(/Uploading/)
    const xhr = FakeXhr.instances[0]
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 })
    await screen.findByText(/50%/)
    xhr.onload?.()

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: "tcimg_1" })))
    await screen.findByText("Uploaded")
  })

  it("shows an error row and does not confirm when the upload fails", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/images/upload")) {
        return mockResponse({
          uploadUrl: "https://fake-r2.invalid/key", objectKey: "key", imageId: "tcimg_1",
          expiresAt: "2026-01-01T00:00:00.000Z", requiredHeaders: {},
        }, 201)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const onUploaded = jest.fn()
    render(<ImageUploadQueue variantId="tcvar_1" files={[fakeFile()]} onUploaded={onUploaded} />)

    await screen.findByText(/Uploading/)
    const xhr = FakeXhr.instances[0]
    xhr.status = 500
    xhr.onload?.()

    await screen.findByText("Upload failed")
    expect(onUploaded).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/confirm"), expect.anything())
  })

  it("rejects an invalid file before ever calling the upload endpoint", async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    render(<ImageUploadQueue variantId="tcvar_1" files={[fakeFile("card.gif", "image/gif")]} onUploaded={jest.fn()} />)

    await screen.findByText("Only JPEG, PNG or WEBP images are supported.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows a distinct confirming state while the confirmation request is in flight", async () => {
    let resolveConfirm: ((value: unknown) => void) | undefined
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/images/upload")) {
        return mockResponse({
          uploadUrl: "https://fake-r2.invalid/key", objectKey: "key", imageId: "tcimg_1",
          expiresAt: "2026-01-01T00:00:00.000Z", requiredHeaders: {},
        }, 201)
      }
      if (url.includes("/images/tcimg_1/confirm")) {
        return new Promise((resolve) => {
          resolveConfirm = resolve as (value: unknown) => void
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<ImageUploadQueue variantId="tcvar_1" files={[fakeFile()]} onUploaded={jest.fn()} />)

    await screen.findByText(/Uploading/)
    const xhr = FakeXhr.instances[0]
    xhr.onload?.()

    await screen.findByText("Confirming…")
    expect(screen.queryByText("Uploaded")).not.toBeInTheDocument()

    resolveConfirm?.(mockResponse({ id: "tcimg_1", status: "READY" } satisfies Partial<CardImageDto>))
    await screen.findByText("Uploaded")
  })

  it("never runs more than MAX_CONCURRENT_UPLOADS (3) uploads at once", async () => {
    const fetchMock = autoUploadFetchMock((index) => `tcimg_${index}`)
    global.fetch = fetchMock as unknown as typeof fetch

    const files = Array.from({ length: 6 }, (_, index) => fakeFile(`card-${index}.jpg`))
    render(<ImageUploadQueue variantId="tcvar_1" files={files} onUploaded={jest.fn()} />)

    await waitFor(() => expect(FakeXhr.instances.length).toBe(3))
    // Give any stray microtasks a chance to run; the count must not creep past 3
    // while every in-flight upload is still unresolved.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(FakeXhr.instances.length).toBe(3)

    // Completing one upload's full pipeline should free a worker slot for the 4th file.
    FakeXhr.instances[0].onload?.()
    await waitFor(() => expect(FakeXhr.instances.length).toBe(4))
    expect(FakeXhr.instances.length).toBeLessThanOrEqual(4)
  })

  it("aborts every active XHR and stops updating state when a new batch replaces the queue mid-upload", async () => {
    const fetchMock = autoUploadFetchMock((index) => `first_${index}`)
    global.fetch = fetchMock as unknown as typeof fetch

    const onUploadedFirst = jest.fn()
    const firstBatch = [fakeFile("first-1.jpg"), fakeFile("first-2.jpg")]
    const { rerender } = render(
      <ImageUploadQueue variantId="tcvar_1" files={firstBatch} onUploaded={onUploadedFirst} />
    )

    await waitFor(() => expect(FakeXhr.instances.length).toBe(2))
    const firstBatchXhrs = [...FakeXhr.instances]
    expect(firstBatchXhrs.every((xhr) => !xhr.aborted)).toBe(true)

    // Overlapping batch selection: replace the queue before the first batch finishes.
    const secondFetchMock = autoUploadFetchMock((index) => `second_${index}`)
    global.fetch = secondFetchMock as unknown as typeof fetch
    const onUploadedSecond = jest.fn()
    const secondBatch = [fakeFile("second-1.jpg")]
    rerender(<ImageUploadQueue variantId="tcvar_1" files={secondBatch} onUploaded={onUploadedSecond} />)

    // Queue replacement must abort every XHR the previous batch started.
    expect(firstBatchXhrs.every((xhr) => xhr.aborted)).toBe(true)

    // The abandoned batch's rows must be gone; only the new batch is rendered.
    expect(screen.queryByText("first-1.jpg")).not.toBeInTheDocument()
    expect(screen.queryByText("first-2.jpg")).not.toBeInTheDocument()
    await screen.findByText("second-1.jpg")

    // Resolving the abandoned XHRs after the fact must not resurrect their rows
    // or fire the stale onUploaded callback.
    firstBatchXhrs[0].status = 200
    firstBatchXhrs[0].onload?.()
    firstBatchXhrs[1].status = 200
    firstBatchXhrs[1].onload?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onUploadedFirst).not.toHaveBeenCalled()
    expect(screen.queryByText("first-1.jpg")).not.toBeInTheDocument()

    const secondXhr = FakeXhr.instances.find((xhr) => !xhr.aborted)
    expect(secondXhr).toBeDefined()
    secondXhr?.onload?.()
    await waitFor(() => expect(onUploadedSecond).toHaveBeenCalledWith(expect.objectContaining({ id: "second_0" })))
  })
})
