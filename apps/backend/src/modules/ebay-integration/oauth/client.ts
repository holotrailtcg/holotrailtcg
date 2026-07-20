import { randomUUID } from "node:crypto"
import type { z } from "@medusajs/framework/zod"
import type { EbayEnvironmentConfig } from "../config"
import {
  EBAY_E1_SCOPES, EBAY_MAX_REMOTE_RESPONSE_BYTES, EBAY_OAUTH_TIMEOUT_MS,
  EBAY_SAFE_ERROR, type EbaySafeErrorCategory,
} from "../types"
import {
  ebayAuthorisationTokenResponseSchema, ebayIdentityResponseSchema, ebayRefreshTokenResponseSchema,
  type EbayAuthorisationTokenResponse, type EbayIdentityResponse, type EbayRefreshTokenResponse,
} from "./schemas"

export class EbayRemoteError extends Error {
  constructor(public readonly category: EbaySafeErrorCategory, public readonly correlationId: string) {
    super(`The eBay request failed (${category}; reference ${correlationId}).`)
    this.name = "EbayRemoteError"
  }
}

async function readBoundedBody(response: Response, correlationId: string): Promise<Buffer> {
  const contentLength = response.headers.get("content-length")
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > EBAY_MAX_REMOTE_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new EbayRemoteError(EBAY_SAFE_ERROR.INVALID_REMOTE_RESPONSE, correlationId)
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > EBAY_MAX_REMOTE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new EbayRemoteError(EBAY_SAFE_ERROR.INVALID_REMOTE_RESPONSE, correlationId)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length)
}

function parseBoundedJson(buffer: Buffer, correlationId: string): unknown {
  try {
    return JSON.parse(buffer.toString("utf8"))
  } catch {
    throw new EbayRemoteError(EBAY_SAFE_ERROR.INVALID_REMOTE_RESPONSE, correlationId)
  }
}

function classifyFailure(status: number, body: unknown): EbaySafeErrorCategory {
  const errorCode = typeof body === "object" && body !== null && "error" in body
    ? String((body as { error?: unknown }).error)
    : ""
  if (errorCode === "invalid_grant" || errorCode === "invalid_token") return EBAY_SAFE_ERROR.REFRESH_REQUIRED
  if (status >= 500 || status === 429) return EBAY_SAFE_ERROR.REMOTE_UNAVAILABLE
  return EBAY_SAFE_ERROR.OAUTH_REJECTED
}

async function requestJson<T>(input: {
  url: string
  init: RequestInit
  schema: z.ZodType<T>
  correlationId?: string
}): Promise<{ value: T; correlationId: string }> {
  const correlationId = input.correlationId ?? randomUUID()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EBAY_OAUTH_TIMEOUT_MS)
  try {
    const response = await fetch(input.url, { ...input.init, signal: controller.signal })
    const buffer = await readBoundedBody(response, correlationId)
    let body: unknown
    try {
      body = parseBoundedJson(buffer, correlationId)
    } catch (error) {
      if (!response.ok) throw new EbayRemoteError(classifyFailure(response.status, undefined), correlationId)
      throw error
    }
    if (!response.ok) throw new EbayRemoteError(classifyFailure(response.status, body), correlationId)
    const parsed = input.schema.safeParse(body)
    if (!parsed.success) throw new EbayRemoteError(EBAY_SAFE_ERROR.INVALID_REMOTE_RESPONSE, correlationId)
    return { value: parsed.data, correlationId }
  } catch (error) {
    if (error instanceof EbayRemoteError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new EbayRemoteError(EBAY_SAFE_ERROR.REMOTE_TIMEOUT, correlationId)
    }
    throw new EbayRemoteError(EBAY_SAFE_ERROR.REMOTE_UNAVAILABLE, correlationId)
  } finally {
    clearTimeout(timeout)
  }
}

function basicCredentials(config: EbayEnvironmentConfig): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")
}

export function buildEbayAuthorisationUrl(config: EbayEnvironmentConfig, state: string): string {
  const url = new URL(config.authorisationUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", EBAY_E1_SCOPES.join(" "))
  url.searchParams.set("state", state)
  return url.toString()
}

export async function exchangeAuthorisationCode(
  config: EbayEnvironmentConfig,
  code: string,
  correlationId?: string
): Promise<{ token: EbayAuthorisationTokenResponse; correlationId: string }> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri })
  const result = await requestJson({
    url: config.tokenUrl,
    init: { method: "POST", headers: {
      Authorization: `Basic ${basicCredentials(config)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    }, body },
    schema: ebayAuthorisationTokenResponseSchema,
    correlationId,
  })
  return { token: result.value, correlationId: result.correlationId }
}

export async function refreshUserAccessToken(
  config: EbayEnvironmentConfig,
  refreshToken: string,
  correlationId?: string
): Promise<{ token: EbayRefreshTokenResponse; correlationId: string }> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  const result = await requestJson({
    url: config.tokenUrl,
    init: { method: "POST", headers: {
      Authorization: `Basic ${basicCredentials(config)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    }, body },
    schema: ebayRefreshTokenResponseSchema,
    correlationId,
  })
  return { token: result.value, correlationId: result.correlationId }
}

export async function getEbayIdentity(
  config: EbayEnvironmentConfig,
  accessToken: string,
  correlationId?: string
): Promise<{ identity: EbayIdentityResponse; correlationId: string }> {
  const result = await requestJson({
    url: config.identityUrl,
    init: { headers: { Authorization: `Bearer ${accessToken}` } },
    schema: ebayIdentityResponseSchema,
    correlationId,
  })
  return { identity: result.value, correlationId: result.correlationId }
}

export async function revokeRefreshToken(
  config: EbayEnvironmentConfig,
  refreshToken: string,
  correlationId?: string
): Promise<{ correlationId: string }> {
  const id = correlationId ?? randomUUID()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EBAY_OAUTH_TIMEOUT_MS)
  try {
    const response = await fetch(config.revokeUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${basicCredentials(config)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }),
      signal: controller.signal,
    })
    if (!response.ok) {
      // Drain a bounded amount without retaining or surfacing the provider body.
      await readBoundedBody(response, id).catch(() => undefined)
      throw new EbayRemoteError(response.status >= 500 ? EBAY_SAFE_ERROR.REMOTE_UNAVAILABLE : EBAY_SAFE_ERROR.OAUTH_REJECTED, id)
    }
    // eBay normally returns an empty success. Drain any unexpected success
    // body through the same hard bound rather than leaving a stream unread.
    await readBoundedBody(response, id)
    return { correlationId: id }
  } catch (error) {
    if (error instanceof EbayRemoteError) throw error
    if (error instanceof Error && error.name === "AbortError") throw new EbayRemoteError(EBAY_SAFE_ERROR.REMOTE_TIMEOUT, id)
    throw new EbayRemoteError(EBAY_SAFE_ERROR.REMOTE_UNAVAILABLE, id)
  } finally {
    clearTimeout(timeout)
  }
}
