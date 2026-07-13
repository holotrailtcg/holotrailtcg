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
