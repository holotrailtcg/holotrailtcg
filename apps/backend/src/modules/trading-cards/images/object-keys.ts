import { randomUUID } from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"
import { SUPPORTED_IMAGE_MIME_TYPES, type SupportedImageMimeType } from "../types"
import { MANAGED_FINAL_PREFIX, MANAGED_STAGING_PREFIX } from "./managed-prefixes"

/**
 * Server-generated object-key helpers for Cloudflare R2. Keys never carry the
 * uploaded filename; they are built only from the owning variant ID, the
 * `CardImage` row ID, and a fresh cryptographically secure UUID, so an
 * attacker-controlled filename can never influence storage layout.
 */

const EXTENSION_BY_MIME_TYPE: Record<SupportedImageMimeType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export function canonicalExtensionForMimeType(mimeType: string): "jpg" | "png" | "webp" {
  const extension = EXTENSION_BY_MIME_TYPE[mimeType as SupportedImageMimeType]
  if (!extension) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unsupported image MIME type: must be one of ${SUPPORTED_IMAGE_MIME_TYPES.join(", ")}`
    )
  }
  return extension
}

/** Deliberately narrow: generated IDs are always `[A-Za-z0-9_-]+`, so anything else is rejected rather than encoded. */
const SAFE_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

function assertSafeKeySegment(name: string, value: string): string {
  if (!value || !SAFE_KEY_SEGMENT_PATTERN.test(value)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${name} contains characters that are not safe in an object-key path segment`
    )
  }
  return value
}

export interface ObjectKeyInput {
  variantId: string
  imageId: string
  mimeType: string
}

function buildObjectKey(prefix: string, input: ObjectKeyInput): string {
  const variantId = assertSafeKeySegment("variantId", input.variantId)
  const imageId = assertSafeKeySegment("imageId", input.imageId)
  const extension = canonicalExtensionForMimeType(input.mimeType)
  return `${prefix}${variantId}/${imageId}/${randomUUID()}.${extension}`
}

export function generateStagingObjectKey(input: ObjectKeyInput): string {
  return buildObjectKey(MANAGED_STAGING_PREFIX, input)
}

export function generateFinalObjectKey(input: ObjectKeyInput): string {
  return buildObjectKey(MANAGED_FINAL_PREFIX, input)
}

const MAX_ORIGINAL_FILENAME_LENGTH = 255

/**
 * Strips any path portion and control characters from an uploaded filename
 * before it is stored for display purposes. This value is never used to
 * build an object key (see above) and must never be trusted as a path.
 */
export function sanitiseOriginalFilename(filename: string): string {
  const withoutPath = filename.replace(/^.*[\\/]/, "")
  const withoutControlChars = withoutPath.replace(/[\x00-\x1f\x7f]/g, "")
  const bounded = withoutControlChars.trim().slice(0, MAX_ORIGINAL_FILENAME_LENGTH)
  return bounded.length > 0 ? bounded : "upload"
}

/**
 * Derives a public R2 URL from the configured public base URL and a stored
 * object key. Encodes each path segment independently so a key can never be
 * reinterpreted as extra path structure; never accepts or embeds credentials.
 */
export function derivePublicImageUrl(publicBaseUrl: string, objectKey: string): string {
  const trimmedBase = publicBaseUrl.replace(/\/+$/, "")
  const encodedPath = objectKey
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${trimmedBase}/${encodedPath}`
}
