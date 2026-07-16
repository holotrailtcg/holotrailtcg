export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

/** Mirrors the backend's MAX_CARD_IMAGE_BYTE_SIZE. Admin extension code cannot import from src/modules/* at build time. */
export const MAX_UPLOAD_BYTE_SIZE = 10 * 1024 * 1024

/** How many uploads the queue runs concurrently. Configurable in one place rather than a magic number inline. */
export const MAX_CONCURRENT_UPLOADS = 3

export type FileValidationResult = { valid: true } | { valid: false; reason: string }

export function validateFileForUpload(file: File): FileValidationResult {
  if (!(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { valid: false, reason: "Only JPEG, PNG or WEBP images are supported." }
  }
  if (file.size === 0) {
    return { valid: false, reason: "This file is empty." }
  }
  if (file.size > MAX_UPLOAD_BYTE_SIZE) {
    return { valid: false, reason: "Images must be 10MB or smaller." }
  }
  return { valid: true }
}

export interface UploadToR2Input {
  uploadUrl: string
  requiredHeaders: Record<string, string>
  file: File
  onProgress?: (fractionComplete: number) => void
  /**
   * Called synchronously with the live `XMLHttpRequest` as soon as it is
   * created, so a caller that owns the upload's lifetime (e.g. a queue being
   * cancelled or replaced) can abort it from the outside.
   */
  registerXhr?: (xhr: XMLHttpRequest) => void
  unregisterXhr?: (xhr: XMLHttpRequest) => void
}

/**
 * Uploads directly to R2 via a presigned PUT URL. Uses `XMLHttpRequest`
 * (not `fetch`) specifically because it is the only way to observe upload
 * progress in the browser.
 */
export function uploadToR2(input: UploadToR2Input): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    input.registerXhr?.(xhr)

    const settle = (run: () => void) => {
      input.unregisterXhr?.(xhr)
      run()
    }

    xhr.open("PUT", input.uploadUrl, true)
    for (const [key, value] of Object.entries(input.requiredHeaders)) {
      xhr.setRequestHeader(key, value)
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && input.onProgress) {
        input.onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`))
        }
      })
    }
    xhr.onerror = () => settle(() => reject(new Error("Upload failed")))
    xhr.onabort = () => settle(() => reject(new Error("Upload aborted")))
    xhr.send(input.file)
  })
}
