import { z } from "@medusajs/framework/zod"
import { TCGDEX_ERROR_CODE, TcgDexError } from "./errors"

export const DEFAULT_TCGDEX_CONFIG = {
  apiBaseUrl: "https://api.tcgdex.net",
  requestTimeoutMs: 5_000,
  maxRetries: 3,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 4_000,
  maxResponseBytes: 1_048_576,
} as const

const integer = (name: string, min: number, max: number) =>
  z.coerce.number().int(`${name} must be an integer`).min(min, `${name} is too small`).max(max, `${name} is too large`)

const configSchema = z.object({
  apiBaseUrl: z.string().trim().url("TCGDEX_API_BASE_URL must be a URL"),
  requestTimeoutMs: integer("TCGDEX_REQUEST_TIMEOUT_MS", 1, 120_000),
  maxRetries: integer("TCGDEX_MAX_RETRIES", 0, 10),
  retryBaseDelayMs: integer("TCGDEX_RETRY_BASE_DELAY_MS", 1, 60_000),
  retryMaxDelayMs: integer("TCGDEX_RETRY_MAX_DELAY_MS", 1, 300_000),
  maxResponseBytes: integer("TCGDEX_MAX_RESPONSE_BYTES", 1_024, 10_485_760),
})

export type TcgDexConfig = z.infer<typeof configSchema>
export type TcgDexEnvironment = Record<string, string | undefined>

function isAllowedHttpUrl(url: URL, environment: TcgDexEnvironment) {
  if (url.protocol === "https:") return true
  if (url.protocol !== "http:") return false

  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  return localHost && (environment.NODE_ENV === "test" || environment.TCGDEX_ALLOW_INSECURE_LOCALHOST === "true")
}

export function loadTcgDexConfig(environment: TcgDexEnvironment = process.env): TcgDexConfig {
  const parsed = configSchema.safeParse({
    apiBaseUrl: environment.TCGDEX_API_BASE_URL ?? DEFAULT_TCGDEX_CONFIG.apiBaseUrl,
    requestTimeoutMs: environment.TCGDEX_REQUEST_TIMEOUT_MS ?? DEFAULT_TCGDEX_CONFIG.requestTimeoutMs,
    maxRetries: environment.TCGDEX_MAX_RETRIES ?? DEFAULT_TCGDEX_CONFIG.maxRetries,
    retryBaseDelayMs: environment.TCGDEX_RETRY_BASE_DELAY_MS ?? DEFAULT_TCGDEX_CONFIG.retryBaseDelayMs,
    retryMaxDelayMs: environment.TCGDEX_RETRY_MAX_DELAY_MS ?? DEFAULT_TCGDEX_CONFIG.retryMaxDelayMs,
    maxResponseBytes: environment.TCGDEX_MAX_RESPONSE_BYTES ?? DEFAULT_TCGDEX_CONFIG.maxResponseBytes,
  })

  if (!parsed.success) {
    throw new TcgDexError({
      code: TCGDEX_ERROR_CODE.CONFIGURATION_ERROR,
      message: "Invalid TCGdex configuration",
      operation: "load-config",
    })
  }

  const url = new URL(parsed.data.apiBaseUrl)
  if (!isAllowedHttpUrl(url, environment) || url.username || url.password || url.search || url.hash) {
    throw new TcgDexError({
      code: TCGDEX_ERROR_CODE.CONFIGURATION_ERROR,
      message: "Invalid TCGDEX_API_BASE_URL configuration",
      operation: "load-config",
    })
  }

  if (parsed.data.retryBaseDelayMs > parsed.data.retryMaxDelayMs) {
    throw new TcgDexError({
      code: TCGDEX_ERROR_CODE.CONFIGURATION_ERROR,
      message: "TCGDEX_RETRY_BASE_DELAY_MS cannot exceed TCGDEX_RETRY_MAX_DELAY_MS",
      operation: "load-config",
    })
  }

  return { ...parsed.data, apiBaseUrl: url.toString().replace(/\/$/, "") }
}

