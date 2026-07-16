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
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor() {
    FakeXhr.instances.push(this)
  }

  open() {}
  setRequestHeader() {}
  send() {}
}

function fakeFile(name = "card.jpg", type = "image/jpeg", size = 1024): File {
  return { name, type, size } as unknown as File
}

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
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
})
