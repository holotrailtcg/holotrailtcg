export const TCGDEX_ERROR_CODE = {
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_ERROR: "SERVER_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
} as const

export type TcgDexErrorCode = (typeof TCGDEX_ERROR_CODE)[keyof typeof TCGDEX_ERROR_CODE]

export class TcgDexError extends Error {
  readonly name = "TcgDexError"
  readonly code: TcgDexErrorCode
  readonly status?: number
  readonly retryable: boolean
  readonly attemptCount: number
  readonly operation: string

  constructor(input: {
    code: TcgDexErrorCode
    message: string
    operation: string
    attemptCount?: number
    retryable?: boolean
    status?: number
  }) {
    super(input.message)
    this.code = input.code
    this.operation = input.operation
    this.attemptCount = input.attemptCount ?? 1
    this.retryable = input.retryable ?? false
    this.status = input.status
  }
}
