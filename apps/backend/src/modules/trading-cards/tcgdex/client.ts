import { loadTcgDexConfig, type TcgDexConfig } from "./config"
import { TCGDEX_ERROR_CODE, TcgDexError } from "./errors"
import { mapTcgDexLanguage } from "./language"
import { tcgDexCardSchema } from "./schemas"
import type { TcgDexClientDependencies, TcgDexFetch, TcgDexCard, TcgDexLanguage } from "./types"

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

function safeIdentifier(value: string, name: string) {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\u0000")) {
    throw new TcgDexError({ code: TCGDEX_ERROR_CODE.INVALID_REQUEST, message: `Invalid ${name}`, operation: name })
  }
  return value.trim()
}

function retryAfterMs(value: string | null, now: () => number, maxDelay: number) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, maxDelay)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.min(Math.max(0, date - now()), maxDelay)
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError" ||
    error instanceof Error && error.name === "AbortError"
}

type BodyReadFailureKind = "TIMEOUT" | "NETWORK_ERROR" | "INVALID_RESPONSE"

class BodyReadFailure extends Error {
  readonly kind: BodyReadFailureKind

  constructor(kind: BodyReadFailureKind) {
    super("TCGdex response body could not be read")
    this.kind = kind
  }
}

async function readBoundedBody(response: Response, maximumBytes: number) {
  if (!response.body) {
    let body: string
    try {
      body = await response.text()
    } catch (error) {
      throw new BodyReadFailure(isAbortError(error) ? "TIMEOUT" : "INVALID_RESPONSE")
    }
    return new TextEncoder().encode(body).byteLength > maximumBytes ? null : body
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        try { await reader.cancel() } catch { /* preserve the size classification */ }
        return null
      }
      chunks.push(value)
    }
  } catch (error) {
    try { await reader.cancel() } catch { /* preserve the primary body-read failure */ }
    throw new BodyReadFailure(isAbortError(error) ? "TIMEOUT" : "NETWORK_ERROR")
  } finally {
    try { reader.releaseLock() } catch { /* no raw reader error may escape */ }
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export class TcgDexClient {
  private readonly config: TcgDexConfig
  private readonly fetchImpl: TcgDexFetch
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly now: () => number

  constructor(config?: TcgDexConfig, dependencies: TcgDexClientDependencies = {}) {
    this.config = config ?? loadTcgDexConfig()
    this.fetchImpl = dependencies.fetchImpl ?? fetch
    this.sleep = dependencies.sleep ?? defaultSleep
    this.now = dependencies.now ?? Date.now
  }

  async getCardBySetAndLocalId(language: TcgDexLanguage, setId: string, localId: string): Promise<TcgDexCard> {
    return this.request(language, ["sets", safeIdentifier(setId, "set ID"), safeIdentifier(localId, "local ID")], "get-card-by-set-and-local-id")
  }

  async getCardById(language: TcgDexLanguage, cardId: string): Promise<TcgDexCard> {
    return this.request(language, ["cards", safeIdentifier(cardId, "card ID")], "get-card-by-id")
  }

  private async request(language: TcgDexLanguage, pathParts: string[], operation: string) {
    const apiLanguage = mapTcgDexLanguage(language)
    const url = new URL(`${this.config.apiBaseUrl}/v2/${apiLanguage}/`)
    for (const part of pathParts) url.pathname += `${encodeURIComponent(part)}/`
    url.pathname = url.pathname.replace(/\/$/, "")

    for (let retry = 0; retry <= this.config.maxRetries; retry += 1) {
      const attemptCount = retry + 1
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)

      try {
        let response: Response
        try {
          // Redirects are rejected so a provider response cannot silently move this client to another origin.
          response = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, redirect: "error", signal: controller.signal })
        } catch (error) {
          const timedOut = isAbortError(error)
          const code = timedOut ? TCGDEX_ERROR_CODE.TIMEOUT : TCGDEX_ERROR_CODE.NETWORK_ERROR
          if (retry < this.config.maxRetries) {
            await this.waitBeforeRetry(retry, undefined)
            continue
          }
          throw this.error(code, timedOut ? "TCGdex request timed out" : "TCGdex network request failed", operation, attemptCount)
        }

        if (response.status === 404) throw this.error(TCGDEX_ERROR_CODE.NOT_FOUND, "TCGdex card was not found", operation, attemptCount, response.status)
        if (response.status === 429 || response.status >= 500) {
          const code = response.status === 429 ? TCGDEX_ERROR_CODE.RATE_LIMITED : TCGDEX_ERROR_CODE.SERVER_ERROR
          if (retry < this.config.maxRetries) {
            await this.waitBeforeRetry(retry, response.headers.get("Retry-After"))
            continue
          }
          throw this.error(code, response.status === 429 ? "TCGdex rate limit reached" : "TCGdex server error", operation, attemptCount, response.status)
        }
        if (!response.ok) throw this.error(TCGDEX_ERROR_CODE.INVALID_RESPONSE, "TCGdex returned an unexpected response", operation, attemptCount, response.status)

        const contentLength = Number(response.headers.get("Content-Length"))
        if (Number.isFinite(contentLength) && contentLength > this.config.maxResponseBytes) {
          throw this.error(TCGDEX_ERROR_CODE.INVALID_RESPONSE, "TCGdex response is too large", operation, attemptCount)
        }

        let body: string | null
        try {
          body = await readBoundedBody(response, this.config.maxResponseBytes)
        } catch (error) {
          const failure = error instanceof BodyReadFailure ? error.kind : "INVALID_RESPONSE"
          if (failure === TCGDEX_ERROR_CODE.TIMEOUT || failure === TCGDEX_ERROR_CODE.NETWORK_ERROR) {
            if (retry < this.config.maxRetries) {
              await this.waitBeforeRetry(retry, undefined)
              continue
            }
          }
          throw this.error(failure, failure === TCGDEX_ERROR_CODE.TIMEOUT
            ? "TCGdex response timed out while reading"
            : failure === TCGDEX_ERROR_CODE.NETWORK_ERROR
              ? "TCGdex response failed while reading"
              : "TCGdex response could not be read", operation, attemptCount)
        }
        if (body === null) {
          throw this.error(TCGDEX_ERROR_CODE.INVALID_RESPONSE, "TCGdex response is too large", operation, attemptCount)
        }

        let parsed: unknown
        try { parsed = JSON.parse(body) } catch { throw this.error(TCGDEX_ERROR_CODE.INVALID_RESPONSE, "TCGdex returned malformed JSON", operation, attemptCount) }
        const result = tcgDexCardSchema.safeParse(parsed)
        if (!result.success) throw this.error(TCGDEX_ERROR_CODE.INVALID_RESPONSE, "TCGdex response failed validation", operation, attemptCount)
        return result.data
      } finally {
        clearTimeout(timeout)
      }
    }

    throw this.error(TCGDEX_ERROR_CODE.SERVER_ERROR, "TCGdex request failed", operation, this.config.maxRetries + 1)
  }

  private async waitBeforeRetry(retry: number, retryAfter: string | null | undefined) {
    const headerDelay = retryAfterMs(retryAfter ?? null, this.now, this.config.retryMaxDelayMs)
    const exponentialDelay = Math.min(this.config.retryBaseDelayMs * (2 ** retry), this.config.retryMaxDelayMs)
    await this.sleep(headerDelay ?? exponentialDelay)
  }

  private error(code: typeof TCGDEX_ERROR_CODE[keyof typeof TCGDEX_ERROR_CODE], message: string, operation: string, attemptCount: number, status?: number) {
    return new TcgDexError({ code, message, operation, attemptCount, status, retryable: code === TCGDEX_ERROR_CODE.RATE_LIMITED || code === TCGDEX_ERROR_CODE.SERVER_ERROR || code === TCGDEX_ERROR_CODE.TIMEOUT || code === TCGDEX_ERROR_CODE.NETWORK_ERROR })
  }
}
