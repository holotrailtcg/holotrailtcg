import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { MedusaError } from "@medusajs/framework/utils"
import type { R2EnabledConfig } from "./r2-config"
import { MAX_CARD_IMAGE_BYTE_SIZE } from "../types"
import { assertManagedKey, assertManagedPrefix } from "./managed-prefixes"

/**
 * The presigned-upload/fetch/store/cleanup seam Stage 4B.2/4B.4 need against
 * Cloudflare R2. The final object is always written with a fresh
 * `PutObjectCommand` of the re-encoded bytes rather than a server-side copy,
 * since the bytes are already in hand and get re-encoded before they are
 * ever stored anywhere. `listObjects`/`deleteObject` exist only to support
 * the Stage 4B.4 cleanup jobs (see `docs/operations/stage-4b-4-*.md`) and
 * are deliberately narrow: `listObjects` only accepts one of the two
 * managed-prefix constants (`managed-prefixes.ts`), never a caller-supplied
 * arbitrary string, and `deleteObject`/`headObject` only accept a key that is
 * a real descendant of one of those same two prefixes — there is no generic
 * bucket access.
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

export interface ListedObject {
  key: string
  lastModified: Date
  size: number
}

export interface ListObjectsPage {
  objects: ListedObject[]
  /** Present iff more pages remain; pass back in as `continuationToken` to page. */
  nextContinuationToken?: string
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
  /** Only accepts a key under a managed prefix. Throws `MedusaError.Types.NOT_FOUND` if the object does not exist. */
  headObject(key: string): Promise<{ lastModified: Date; size: number }>
  /** Idempotent: deleting an already-deleted or never-existing key is a silent success. Only accepts a key under a managed prefix. */
  deleteObject(key: string): Promise<void>
  /** `prefix` must be one of the two managed-prefix constants — enforced by `assertManagedPrefix`. */
  listObjects(input: { prefix: string; continuationToken?: string; maxKeys?: number }): Promise<ListObjectsPage>
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

/** The subset of `HeadObjectCommandOutput` `mapHeadObjectResponse` needs — pure with respect to the network, so it is the seam unit tests exercise instead of the real `S3Client`. */
export interface RawHeadObjectResponse {
  LastModified?: Date
  ContentLength?: number
}

export function mapHeadObjectResponse(response: RawHeadObjectResponse): { lastModified: Date; size: number } {
  return {
    lastModified: response.LastModified ?? new Date(0),
    size: response.ContentLength ?? 0,
  }
}

/** The subset of `ListObjectsV2CommandOutput` `mapListObjectsV2Response` needs — pure with respect to the network, so it is the seam unit tests exercise instead of the real `S3Client`. */
export interface RawListObjectsV2Response {
  Contents?: Array<{ Key?: string; LastModified?: Date; Size?: number }>
  IsTruncated?: boolean
  NextContinuationToken?: string
}

/** Entries with no `Key` (never expected in a real response) are dropped rather than surfaced as a malformed `ListedObject`. */
export function mapListObjectsV2Response(response: RawListObjectsV2Response): ListObjectsPage {
  const objects: ListedObject[] = (response.Contents ?? [])
    .filter((entry): entry is typeof entry & { Key: string } => typeof entry.Key === "string")
    .map((entry) => ({
      key: entry.Key,
      lastModified: entry.LastModified ?? new Date(0),
      size: entry.Size ?? 0,
    }))
  return {
    objects,
    nextContinuationToken: response.IsTruncated ? response.NextContinuationToken : undefined,
  }
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

    async headObject(key) {
      assertManagedKey(key)
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }))
        return mapHeadObjectResponse(response)
      } catch (error) {
        if (
          error instanceof NotFound ||
          (error as { name?: string; $metadata?: { httpStatusCode?: number } }).name === "NotFound" ||
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
        ) {
          throw new MedusaError(MedusaError.Types.NOT_FOUND, "The stored object could not be found")
        }
        // Never surface a raw AWS SDK error (message/stack/request ID) to a caller.
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The stored object could not be inspected")
      }
    },

    async deleteObject(key) {
      assertManagedKey(key)
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }))
      } catch {
        // Never surface a raw AWS SDK error (message/stack/request ID) to a caller.
        // Deleting an already-missing key is itself a silent success per S3/R2
        // DeleteObject semantics, so any error reaching here is a genuine
        // storage failure, not a "not found" case to swallow separately.
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The stored object could not be deleted")
      }
    },

    async listObjects({ prefix, continuationToken, maxKeys }) {
      assertManagedPrefix(prefix)
      let response
      try {
        response = await client.send(new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: maxKeys,
        }))
      } catch {
        // Never surface a raw AWS SDK error (message/stack/request ID) to a caller.
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The stored objects could not be listed")
      }
      return mapListObjectsV2Response(response)
    },
  }
}
