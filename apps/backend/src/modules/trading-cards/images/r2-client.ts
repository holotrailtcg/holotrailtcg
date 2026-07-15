import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { MedusaError } from "@medusajs/framework/utils"
import type { R2EnabledConfig } from "./r2-config"
import { MAX_CARD_IMAGE_BYTE_SIZE } from "../types"

/**
 * The presigned-upload/fetch/store seam Stage 4B.2 needs against Cloudflare
 * R2. Deliberately narrow: no `deleteObject`/`copyObject`. Staging objects
 * are never synchronously deleted (a superseded or abandoned staging object
 * is simply left in place — cleaning those up is a future, separately
 * protected background job, out of scope for this stage, same as permanent
 * deletion of an archived `CardImage` row in Stage 4B.1), and the final
 * object is always written with a fresh `PutObjectCommand` of the
 * re-encoded bytes rather than a server-side copy, since the bytes are
 * already in hand and get re-encoded before they are ever stored anywhere.
 */

export interface PresignedUpload {
  uploadUrl: string
  /** Headers the browser's PUT request must send for the signature to validate. */
  requiredHeaders: Record<string, string>
  expiresAt: Date
}

export interface FetchedObject {
  bytes: Buffer
  byteSize: number
  contentType?: string | null
}

export interface R2ImageStorageClient {
  createPresignedPutUrl(input: {
    key: string
    contentType: string
    expiresInSeconds: number
  }): Promise<PresignedUpload>
  /** Throws `MedusaError.Types.NOT_FOUND` if the object does not exist. */
  getObject(key: string): Promise<FetchedObject>
  putObject(input: {
    key: string
    body: Buffer
    contentType: string
    contentLength: number
  }): Promise<void>
}

/** Pure so it can be unit-tested without a clock dependency. */
export function expiresAtFromNow(minutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + minutes * 60_000)
}

/** A stream-shaped source this module can bound-read without depending on the real AWS SDK stream types. */
export interface DestroyableByteStream extends AsyncIterable<Uint8Array> {
  destroy?: (error?: Error) => void
}

function destroySafely(stream: DestroyableByteStream | null | undefined): void {
  try {
    stream?.destroy?.()
  } catch {
    // Best-effort only: a failure to abort an already-failed/finished stream
    // is never itself an error worth surfacing.
  }
}

/**
 * Reads `stream` into a single `Buffer`, never accumulating more than
 * `maxBytes + 1` bytes: the read stops and the stream is destroyed the
 * moment the running total exceeds `maxBytes`, so an oversized or
 * maliciously mislabeled object is never fully buffered in memory. Used as
 * the defence-in-depth streaming bound behind the `ContentLength` pre-check
 * in `getObject` — this path is what actually protects against a missing or
 * understated `ContentLength`.
 */
export async function readBoundedStream(stream: DestroyableByteStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > maxBytes) {
        destroySafely(stream)
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "The stored object exceeds the maximum allowed size")
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof MedusaError) throw error
    destroySafely(stream)
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The stored object could not be read from storage")
  }
  return Buffer.concat(chunks)
}

/** The subset of `GetObjectCommandOutput` `readFetchedObjectFromResponse` needs — kept independent of the real AWS SDK response type so it can be unit-tested with a plain object, no S3Client involved. */
export interface RawGetObjectResponse {
  Body?: DestroyableByteStream
  ContentLength?: number
  ContentType?: string
}

/**
 * Turns a raw `GetObject` response into a size-bounded `FetchedObject`.
 * Rejects immediately (no read at all) when `ContentLength` already exceeds
 * `maxBytes`; otherwise defers to `readBoundedStream`, which is what
 * actually protects against a missing or understated `ContentLength`.
 * Pure with respect to the network — takes an already-fetched response
 * object — so it is the seam unit tests exercise instead of the real
 * `S3Client`.
 */
export async function readFetchedObjectFromResponse(
  response: RawGetObjectResponse,
  maxBytes: number
): Promise<FetchedObject> {
  const body = response.Body
  if (!body) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The stored object could not be read from storage")
  }
  if (typeof response.ContentLength === "number" && response.ContentLength > maxBytes) {
    destroySafely(body)
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The stored object exceeds the maximum allowed size")
  }
  const bytes = await readBoundedStream(body, maxBytes)
  return { bytes, byteSize: bytes.length, contentType: response.ContentType ?? null }
}

export function createR2ImageStorageClient(config: R2EnabledConfig): R2ImageStorageClient {
  // `forcePathStyle: true` because R2's account-scoped S3 endpoint
  // (`https://<accountId>.r2.cloudflarestorage.com`) does not embed the
  // bucket name in the hostname the way a per-bucket virtual-hosted-style
  // endpoint would.
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  return {
    async createPresignedPutUrl({ key, contentType, expiresInSeconds }) {
      const command = new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        ContentType: contentType,
      })
      let uploadUrl: string
      try {
        uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds })
      } catch {
        // Never surface a raw AWS SDK error (message/stack/request ID) to a caller.
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "An upload URL could not be generated")
      }
      return {
        uploadUrl,
        requiredHeaders: { "Content-Type": contentType },
        expiresAt: expiresAtFromNow(expiresInSeconds / 60),
      }
    },

    async getObject(key) {
      let response: GetObjectCommandOutput
      try {
        response = await client.send(new GetObjectCommand({ Bucket: config.bucketName, Key: key }))
      } catch (error) {
        if (error instanceof NoSuchKey || (error as { name?: string }).name === "NoSuchKey") {
          throw new MedusaError(MedusaError.Types.NOT_FOUND, "The uploaded file could not be found in storage")
        }
        // Never surface a raw AWS SDK error (message/stack/request ID) to a caller.
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The stored object could not be read from storage")
      }

      return readFetchedObjectFromResponse(
        response as unknown as RawGetObjectResponse,
        MAX_CARD_IMAGE_BYTE_SIZE
      )
    },

    async putObject({ key, body, contentType, contentLength }) {
      try {
        await client.send(new PutObjectCommand({
          Bucket: config.bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: contentLength,
        }))
      } catch {
        // Never surface a raw AWS SDK error (message/stack/request ID) to a caller.
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The confirmed image could not be stored")
      }
    },
  }
}
