export const PULSE_UPLOAD_MAX_BYTE_SIZE = 10 * 1024 * 1024

export interface UploadCsvFields {
  inventorySourceId?: string
  newSourceDisplayName?: string
  newSourceProvider?: string
  newSourceLanguage?: string
  newSourceDefaultCurrencyCode?: string
  previousApprovedSnapshotId?: string
  reason?: string
}

export interface UploadCsvInput {
  file: File
  fields: UploadCsvFields
  onProgress?: (fractionComplete: number) => void
}

export interface UploadCsvHttpResult {
  status: number
  body: unknown
}

/**
 * Uploads a single Pulse CSV file plus its accompanying source-selection
 * fields to `POST /admin/trading-card-inventory/imports/upload` in one
 * multipart request. Uses `XMLHttpRequest` (not `fetch`) specifically to
 * observe upload progress, mirroring `upload-to-r2.ts`'s approach —
 * simplified here since there is only ever one file and no queue.
 */
export function uploadCsv(input: UploadCsvInput): Promise<UploadCsvHttpResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append("file", input.file)
    for (const [key, value] of Object.entries(input.fields)) {
      if (value !== undefined && value !== "") formData.append(key, value)
    }

    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/admin/trading-card-inventory/imports/upload", true)
    xhr.withCredentials = true
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && input.onProgress) {
        input.onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        body = null
      }
      resolve({ status: xhr.status, body })
    }
    xhr.onerror = () => reject(new Error("Upload failed"))
    xhr.send(formData)
  })
}
