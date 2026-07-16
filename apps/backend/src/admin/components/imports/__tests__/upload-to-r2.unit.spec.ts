import { validateFileForUpload, uploadToR2, MAX_UPLOAD_BYTE_SIZE } from "../upload-to-r2"

function fakeFile(overrides: { type?: string; size?: number } = {}): File {
  const size = overrides.size ?? 1024
  const type = overrides.type ?? "image/jpeg"
  return { type, size, name: "card.jpg" } as unknown as File
}

describe("validateFileForUpload", () => {
  it("accepts a JPEG within the size limit", () => {
    expect(validateFileForUpload(fakeFile({ type: "image/jpeg", size: 1024 }))).toEqual({ valid: true })
  })

  it("rejects an unsupported type", () => {
    expect(validateFileForUpload(fakeFile({ type: "image/gif" }))).toEqual({
      valid: false, reason: "Only JPEG, PNG or WEBP images are supported.",
    })
  })

  it("rejects an empty file", () => {
    expect(validateFileForUpload(fakeFile({ size: 0 }))).toEqual({ valid: false, reason: "This file is empty." })
  })

  it("rejects a file over the size limit", () => {
    expect(validateFileForUpload(fakeFile({ size: MAX_UPLOAD_BYTE_SIZE + 1 }))).toEqual({
      valid: false, reason: "Images must be 10MB or smaller.",
    })
  })
})

class FakeXhr {
  static instances: FakeXhr[] = []
  method = ""
  url = ""
  headers: Record<string, string> = {}
  status = 200
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  sentBody: unknown = null

  constructor() {
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }

  send(body: unknown) {
    this.sentBody = body
  }
}

describe("uploadToR2", () => {
  beforeEach(() => {
    FakeXhr.instances = []
    ;(global as unknown as { XMLHttpRequest: typeof FakeXhr }).XMLHttpRequest = FakeXhr
  })

  it("sends a PUT with the exact required headers and reports progress", async () => {
    const file = fakeFile()
    const progressUpdates: number[] = []

    const promise = uploadToR2({
      uploadUrl: "https://fake-r2.invalid/key",
      requiredHeaders: { "Content-Type": "image/jpeg" },
      file,
      onProgress: (value) => progressUpdates.push(value),
    })

    const xhr = FakeXhr.instances[0]
    expect(xhr.method).toBe("PUT")
    expect(xhr.url).toBe("https://fake-r2.invalid/key")
    expect(xhr.headers).toEqual({ "Content-Type": "image/jpeg" })
    expect(xhr.sentBody).toBe(file)

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 })
    xhr.status = 200
    xhr.onload?.()

    await expect(promise).resolves.toBeUndefined()
    expect(progressUpdates).toEqual([0.5])
  })

  it("rejects on a non-2xx status", async () => {
    const promise = uploadToR2({
      uploadUrl: "https://fake-r2.invalid/key", requiredHeaders: {}, file: fakeFile(),
    })
    const xhr = FakeXhr.instances[0]
    xhr.status = 500
    xhr.onload?.()
    await expect(promise).rejects.toThrow(/status 500/)
  })

  it("rejects on a network error", async () => {
    const promise = uploadToR2({
      uploadUrl: "https://fake-r2.invalid/key", requiredHeaders: {}, file: fakeFile(),
    })
    const xhr = FakeXhr.instances[0]
    xhr.onerror?.()
    await expect(promise).rejects.toThrow("Upload failed")
  })
})
