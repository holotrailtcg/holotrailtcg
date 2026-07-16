import { postAction } from "./fetch-json"
import type { BeginUploadResponse, CardImageDto } from "./image-types"
import { MAX_CONCURRENT_UPLOADS, uploadToR2, validateFileForUpload } from "./upload-to-r2"
import type { UploadRowState } from "./upload-progress-row"

export interface QueueRow {
  key: string
  file: File
  state: UploadRowState
  progress: number
  errorMessage?: string
}

export interface UploadQueueCallbacks {
  onRowsChange: (rows: QueueRow[]) => void
  onUploaded: (image: CardImageDto) => void
  onSettled?: () => void
}

/**
 * Owns one upload batch's lifetime: at most `MAX_CONCURRENT_UPLOADS` XHR
 * uploads run at once, and `cancel()` aborts every XHR this instance started
 * and stops it from touching React state again. Callers must never reuse a
 * controller across batches — replacing a batch means cancelling the old
 * controller and constructing a new one, so two controllers' uploads can
 * never be in flight together.
 */
export class UploadQueueController {
  private rows: QueueRow[]
  private cancelled = false
  private nextIndex = 0
  private readonly activeXhrs = new Set<XMLHttpRequest>()

  constructor(
    private readonly variantId: string,
    files: File[],
    private readonly callbacks: UploadQueueCallbacks
  ) {
    this.rows = files.map((file, index) => ({
      key: `${file.name}-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      state: "queued",
      progress: 0,
    }))
  }

  start(): void {
    if (this.rows.length === 0) return
    this.callbacks.onRowsChange(this.rows)

    const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, this.rows.length)
    Promise.all(Array.from({ length: workerCount }, () => this.worker())).then(() => {
      if (!this.cancelled) this.callbacks.onSettled?.()
    })
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const xhr of this.activeXhrs) {
      xhr.abort()
    }
    this.activeXhrs.clear()
  }

  private updateRow(key: string, patch: Partial<QueueRow>): void {
    if (this.cancelled) return
    this.rows = this.rows.map((row) => (row.key === key ? { ...row, ...patch } : row))
    this.callbacks.onRowsChange(this.rows)
  }

  private async worker(): Promise<void> {
    while (!this.cancelled) {
      const index = this.nextIndex
      this.nextIndex += 1
      if (index >= this.rows.length) return
      const row = this.rows[index]

      const validation = validateFileForUpload(row.file)
      if (!validation.valid) {
        this.updateRow(row.key, { state: "error", errorMessage: validation.reason })
        continue
      }

      this.updateRow(row.key, { state: "uploading", progress: 0 })
      try {
        const image = await this.uploadOne(row)
        if (this.cancelled) return
        this.updateRow(row.key, { state: "success", progress: 1 })
        this.callbacks.onUploaded(image)
      } catch {
        if (this.cancelled) return
        this.updateRow(row.key, { state: "error", errorMessage: "This image could not be uploaded. Please try again." })
      }
    }
  }

  private async uploadOne(row: QueueRow): Promise<CardImageDto> {
    const begin = await postAction<BeginUploadResponse>(
      `/admin/trading-cards/variants/${encodeURIComponent(this.variantId)}/images/upload`,
      { originalFilename: row.file.name, declaredMimeType: row.file.type, declaredByteSize: row.file.size }
    )
    if (this.cancelled) throw new Error("cancelled")

    await uploadToR2({
      uploadUrl: begin.uploadUrl,
      requiredHeaders: begin.requiredHeaders,
      file: row.file,
      onProgress: (progress) => this.updateRow(row.key, { progress }),
      registerXhr: (xhr) => {
        if (this.cancelled) {
          xhr.abort()
          return
        }
        this.activeXhrs.add(xhr)
      },
      unregisterXhr: (xhr) => this.activeXhrs.delete(xhr),
    })
    if (this.cancelled) throw new Error("cancelled")

    this.updateRow(row.key, { state: "confirming", progress: 1 })
    return postAction<CardImageDto>(`/admin/trading-cards/images/${encodeURIComponent(begin.imageId)}/confirm`)
  }
}
