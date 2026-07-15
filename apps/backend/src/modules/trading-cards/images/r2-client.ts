import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { MedusaError } from "@medusajs/framework/utils"
import type { R2EnabledConfig } from "./r2-config"

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
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds })
      return {
        uploadUrl,
        requiredHeaders: { "Content-Type": contentType },
        expiresAt: expiresAtFromNow(expiresInSeconds / 60),
      }
    },

    async getObject(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: config.bucketName, Key: key }))
        const bytes = Buffer.from(await response.Body!.transformToByteArray())
        return { bytes, byteSize: bytes.length, contentType: response.ContentType ?? null }
      } catch (error) {
        if (error instanceof NoSuchKey || (error as { name?: string }).name === "NoSuchKey") {
          throw new MedusaError(MedusaError.Types.NOT_FOUND, "The uploaded file could not be found in storage")
        }
        throw error
      }
    },

    async putObject({ key, body, contentType, contentLength }) {
      await client.send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: contentLength,
      }))
    },
  }
}
