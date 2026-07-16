import { createHash } from "node:crypto"
import sharp from "sharp"
import type { SupportedImageMimeType } from "../types"

/**
 * The Stage 4B.2 confirmation-time image pipeline: validates the actual
 * bytes of an uploaded file (never the browser-declared filename or MIME
 * type), strips metadata, auto-orients, re-encodes deterministically, and
 * hashes the result. `sharp`'s own format-sniffing (from the real file
 * bytes via libvips, not from any supplied extension or MIME type) is the
 * magic-byte validation this pipeline relies on — no separate `file-type`
 * package is needed. A format sharp can successfully parse but that is not
 * on `SUPPORTED_SNIFFED_FORMATS` (SVG, GIF, AVIF, TIFF, BMP, HEIC, ...) is
 * still rejected.
 */

export interface ProcessedImage {
  buffer: Buffer
  mimeType: SupportedImageMimeType
  byteSize: number
  width: number
  height: number
  sha256: string
}

export type ProcessCardImageUploadResult =
  | { ok: true; result: ProcessedImage }
  | { ok: false; reason: string }

const MIME_TYPE_BY_SNIFFED_FORMAT: Record<string, SupportedImageMimeType> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

const ENCODE_STEP: Record<SupportedImageMimeType, (pipeline: sharp.Sharp) => sharp.Sharp> = {
  "image/jpeg": (pipeline) => pipeline.jpeg({ quality: 90, mozjpeg: true }),
  "image/png": (pipeline) => pipeline.png({ compressionLevel: 9 }),
  "image/webp": (pipeline) => pipeline.webp({ quality: 90 }),
}

export async function processCardImageUpload(bytes: Buffer): Promise<ProcessCardImageUploadResult> {
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(bytes, { failOn: "error" }).metadata()
  } catch {
    return { ok: false, reason: "corrupted-or-unreadable" }
  }

  const mimeType = metadata.format ? MIME_TYPE_BY_SNIFFED_FORMAT[metadata.format] : undefined
  if (!mimeType) {
    return { ok: false, reason: `unsupported-format:${metadata.format ?? "unknown"}` }
  }

  let encoded: { data: Buffer; info: sharp.OutputInfo }
  try {
    // `.rotate()` with no arguments auto-orients from EXIF and then
    // normalises the orientation tag away. Metadata (EXIF, ICC, GPS, ...)
    // is stripped by default because `.withMetadata()` is never called.
    const pipeline = ENCODE_STEP[mimeType](sharp(bytes, { failOn: "error" }).rotate())
    encoded = await pipeline.toBuffer({ resolveWithObject: true })
  } catch {
    return { ok: false, reason: "corrupted-or-unreadable" }
  }

  if (!encoded.info.width || !encoded.info.height) {
    return { ok: false, reason: "corrupted-or-unreadable" }
  }

  const sha256 = createHash("sha256").update(encoded.data).digest("hex")

  return {
    ok: true,
    result: {
      buffer: encoded.data,
      mimeType,
      byteSize: encoded.data.length,
      width: encoded.info.width,
      height: encoded.info.height,
      sha256,
    },
  }
}
