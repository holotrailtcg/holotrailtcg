import type {
  RecaptchaVerificationReason,
  RecaptchaVerificationResult,
  RecaptchaVerifier,
} from "../../../src/modules/newsletter/recaptcha/verify"
import type {
  ConfirmationEmailSender,
  ConfirmationEmailSendOutcome,
  SendConfirmationEmailInput,
} from "../../../src/modules/newsletter/resend/sender"
import { TcgDexError, type TcgDexLookupDependency } from "../../../src/modules/trading-cards/tcgdex"
import type { TcgDexCard, TcgDexLanguage } from "../../../src/modules/trading-cards/tcgdex/types"

/**
 * Test-only fake reCAPTCHA verifier. Registered into the container before
 * any HTTP request is made (`support/bootstrap.ts`), so the production
 * `GoogleRecaptchaVerifier` — and therefore any real network call to
 * Google — is never constructed during the HTTP integration test suite.
 * Behaviour is mutable between test cases via `programme`.
 */
export class FakeRecaptchaVerifier implements RecaptchaVerifier {
  private mode: "verified" | RecaptchaVerificationReason = "verified"
  public readonly calls: string[] = []

  programme(mode: "verified" | RecaptchaVerificationReason): void {
    this.mode = mode
  }

  async verify(token: string): Promise<RecaptchaVerificationResult> {
    this.calls.push(token)
    if (this.mode === "verified") {
      return { verified: true }
    }
    return { verified: false, reason: this.mode }
  }
}

/**
 * Test-only fake confirmation-email sender. Registered into the container
 * before any HTTP request is made, so the real `resend` package is never
 * called during the HTTP integration test suite.
 */
export class FakeConfirmationEmailSender implements ConfirmationEmailSender {
  private mode: ConfirmationEmailSendOutcome["status"] = "SENT"
  public readonly sends: SendConfirmationEmailInput[] = []

  programme(mode: ConfirmationEmailSendOutcome["status"]): void {
    this.mode = mode
  }

  async send(input: SendConfirmationEmailInput): Promise<ConfirmationEmailSendOutcome> {
    this.sends.push(input)
    if (this.mode === "SENT") {
      return { status: "SENT", providerMessageId: "fake-provider-message-id" }
    }
    return { status: this.mode }
  }
}

type QueuedResult = { type: "card"; card: TcgDexCard } | { type: "error"; error: TcgDexError }

/**
 * Test-only fake TCGdex lookup client. Registered into the container before
 * any HTTP request is made (`support/bootstrap.ts`), so the real
 * `TcgDexClient` — and therefore any real network call to TCGdex — is never
 * constructed during the HTTP integration test suite. Each retry test
 * queues exactly the result it needs with `enqueue`/`enqueueError`.
 */
export class FakeTcgDexClient implements TcgDexLookupDependency {
  private readonly queue: QueuedResult[] = []
  public readonly calls: Array<{ operation: string; language: TcgDexLanguage; setId?: string; localId: string }> = []

  enqueue(card: TcgDexCard): void {
    this.queue.push({ type: "card", card })
  }

  enqueueError(error: TcgDexError): void {
    this.queue.push({ type: "error", error })
  }

  private next(): QueuedResult {
    const result = this.queue.shift()
    if (!result) throw new Error("FakeTcgDexClient: no queued result for this call")
    return result
  }

  async getCardBySetAndLocalId(language: TcgDexLanguage, setId: string, localId: string): Promise<TcgDexCard> {
    this.calls.push({ operation: "getCardBySetAndLocalId", language, setId, localId })
    const result = this.next()
    if (result.type === "error") throw result.error
    return result.card
  }

  async getCardById(language: TcgDexLanguage, cardId: string): Promise<TcgDexCard> {
    this.calls.push({ operation: "getCardById", language, localId: cardId })
    const result = this.next()
    if (result.type === "error") throw result.error
    return result.card
  }
}
