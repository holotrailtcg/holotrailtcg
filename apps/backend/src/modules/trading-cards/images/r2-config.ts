import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Backend-only Cloudflare R2 configuration for the card-image storage
 * foundation. Disabled by default (`R2_IMAGES_ENABLED` must be the exact
 * string `"true"` to enable) so a missing or mistyped value never turns on
 * real network calls; every other value, including unset, keeps local
 * Medusa file behaviour. When enabled, every other value is required and
 * validated; failures never include a secret value, only variable names.
 */

export type R2Environment = Record<string, string | undefined>

export interface R2DisabledConfig {
  enabled: false
}

export interface R2EnabledConfig {
  enabled: true
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  /** Bare HTTPS origin, no trailing slash. */
  endpoint: string
  /** Bare HTTPS origin, no trailing slash. */
  publicBaseUrl: string
  region: "auto"
  cacheControl: string
  acl: false
}

export type ResolvedR2Config = R2DisabledConfig | R2EnabledConfig

export const IMMUTABLE_ONE_YEAR_CACHE_CONTROL = "public, max-age=31536000, immutable"

const requiredTrimmed = (name: string) =>
  z.string({ error: `${name} is required and was not set` }).trim().min(1, `${name} is required and was not set`)

const configSchema = z.object({
  R2_ACCOUNT_ID: requiredTrimmed("R2_ACCOUNT_ID"),
  R2_ACCESS_KEY_ID: requiredTrimmed("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: requiredTrimmed("R2_SECRET_ACCESS_KEY"),
  R2_BUCKET_NAME: requiredTrimmed("R2_BUCKET_NAME"),
  R2_S3_ENDPOINT: requiredTrimmed("R2_S3_ENDPOINT"),
  R2_PUBLIC_BASE_URL: requiredTrimmed("R2_PUBLIC_BASE_URL"),
})

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
/** Cloudflare's default R2 S3 endpoint plus its documented jurisdiction-specific endpoints (EU, FedRAMP). */
const ENDPOINT_HOST_PATTERN = /^([a-f0-9]{32})\.(eu\.|fedramp\.)?r2\.cloudflarestorage\.com$/i

function assertBareHttpsOrigin(name: string, value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} must be a valid URL`)
  }
  if (parsed.protocol !== "https:") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} must use https`)
  }
  if (parsed.username || parsed.password) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} must not contain credentials`)
  }
  if (parsed.search || parsed.hash) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} must not include a query string or fragment`)
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} must be a bare origin, without a path`)
  }
  return parsed
}

/**
 * Exact snake_case option shape read by the real `@medusajs/medusa/file-s3`
 * provider (`S3FileService`). There are no camelCase aliases in the actual
 * provider implementation, so this pure function is the single place that
 * builds the object handed to `defineConfig`'s file-provider `options` — it
 * is unit-tested directly against a fake enabled config to prove the exact
 * key names without booting Medusa or making a real R2 call.
 */
export interface R2FileProviderOptions {
  file_url: string
  access_key_id: string
  secret_access_key: string
  region: "auto"
  bucket: string
  endpoint: string
  cache_control: string
  acl: false
}

export function buildR2FileProviderOptions(config: R2EnabledConfig): R2FileProviderOptions {
  return {
    file_url: config.publicBaseUrl,
    access_key_id: config.accessKeyId,
    secret_access_key: config.secretAccessKey,
    region: config.region,
    bucket: config.bucketName,
    endpoint: config.endpoint,
    cache_control: config.cacheControl,
    acl: config.acl,
  }
}

export function resolveR2Config(env: R2Environment = process.env): ResolvedR2Config {
  if (env.R2_IMAGES_ENABLED !== "true") {
    return { enabled: false }
  }

  const result = configSchema.safeParse(env)
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join("; ")
    throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
  }
  const parsed = result.data

  if (!ACCOUNT_ID_PATTERN.test(parsed.R2_ACCOUNT_ID)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "R2_ACCOUNT_ID must be a 32-character hexadecimal Cloudflare account ID"
    )
  }
  if (!BUCKET_NAME_PATTERN.test(parsed.R2_BUCKET_NAME)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "R2_BUCKET_NAME must be a valid S3-style bucket name")
  }

  const endpointUrl = assertBareHttpsOrigin("R2_S3_ENDPOINT", parsed.R2_S3_ENDPOINT)
  const endpointMatch = ENDPOINT_HOST_PATTERN.exec(endpointUrl.hostname)
  if (!endpointMatch) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "R2_S3_ENDPOINT must be an account-scoped *.r2.cloudflarestorage.com endpoint, optionally jurisdiction-scoped (eu./fedramp.)"
    )
  }
  if (endpointMatch[1].toLowerCase() !== parsed.R2_ACCOUNT_ID.toLowerCase()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "R2_S3_ENDPOINT account ID must match R2_ACCOUNT_ID")
  }

  const publicBaseUrl = assertBareHttpsOrigin("R2_PUBLIC_BASE_URL", parsed.R2_PUBLIC_BASE_URL)

  return {
    enabled: true,
    accountId: parsed.R2_ACCOUNT_ID,
    accessKeyId: parsed.R2_ACCESS_KEY_ID,
    secretAccessKey: parsed.R2_SECRET_ACCESS_KEY,
    bucketName: parsed.R2_BUCKET_NAME,
    endpoint: endpointUrl.origin,
    publicBaseUrl: publicBaseUrl.origin,
    region: "auto",
    cacheControl: IMMUTABLE_ONE_YEAR_CACHE_CONTROL,
    acl: false,
  }
}
