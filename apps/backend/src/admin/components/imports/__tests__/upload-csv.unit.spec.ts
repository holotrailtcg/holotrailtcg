import { uploadCsv } from "../upload-csv"

function fakeFile(content = "a,b\n1,2"): File {
  return new File([content], "import.csv", { type: "text/csv" })
}

class FakeXhr {
  static instances: FakeXhr[] = []
  method = ""
  url = ""
  withCredentials = false
  status = 200
  responseText = "{}"
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

  send(body: unknown) {
    this.sentBody = body
  }
}

describe("uploadCsv", () => {
  beforeEach(() => {
    FakeXhr.instances = []
    ;(global as unknown as { XMLHttpRequest: typeof FakeXhr }).XMLHttpRequest = FakeXhr
  })

  it("posts multipart form data with the file and fields, and reports progress", async () => {
    const progressUpdates: number[] = []
    const promise = uploadCsv({
      file: fakeFile(),
      fields: { inventorySourceId: "tcisrc_1", reason: "" },
      onProgress: (value) => progressUpdates.push(value),
    })

    const xhr = FakeXhr.instances[0]
    expect(xhr.method).toBe("POST")
    expect(xhr.url).toBe("/admin/trading-card-inventory/imports/upload")
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.sentBody).toBeInstanceOf(FormData)
    const formData = xhr.sentBody as FormData
    expect(formData.get("inventorySourceId")).toBe("tcisrc_1")
    expect(formData.get("reason")).toBeNull()

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 })
    xhr.status = 201
    xhr.responseText = JSON.stringify({ kind: "IMPORTED", snapshotId: "tcisnap_1" })
    xhr.onload?.()

    const result = await promise
    expect(result).toEqual({ status: 201, body: { kind: "IMPORTED", snapshotId: "tcisnap_1" } })
    expect(progressUpdates).toEqual([0.25])
  })

  it("resolves with a null body when the response is not valid JSON", async () => {
    const promise = uploadCsv({ file: fakeFile(), fields: {} })
    const xhr = FakeXhr.instances[0]
    xhr.status = 500
    xhr.responseText = "not json"
    xhr.onload?.()
    await expect(promise).resolves.toEqual({ status: 500, body: null })
  })

  it("rejects on a network error", async () => {
    const promise = uploadCsv({ file: fakeFile(), fields: {} })
    const xhr = FakeXhr.instances[0]
    xhr.onerror?.()
    await expect(promise).rejects.toThrow("Upload failed")
  })
})
