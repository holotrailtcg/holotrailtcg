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
import { MedusaError } from "@medusajs/framework/utils"
import { TcgDexError, type TcgDexLookupDependency } from "../../../src/modules/trading-cards/tcgdex"
import type { TcgDexCard, TcgDexLanguage } from "../../../src/modules/trading-cards/tcgdex/types"
import type {
  FetchedObject, ListObjectsPage, PresignedUpload, R2ImageStorageClient,
} from "../../../src/modules/trading-cards/images/r2-client"
import { assertManagedKey, assertManagedPrefix } from "../../../src/modules/trading-cards/images/managed-prefixes"
import type { EbayOAuthClient } from "../../../src/modules/ebay-integration/dependencies"
import { EbayRemoteError } from "../../../src/modules/ebay-integration/oauth/client"

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

/**
 * Test-only fake R2 image storage client. Registered into the container
 * before any HTTP request is made (`support/bootstrap.ts`), so the real
 * `createR2ImageStorageClient` — and therefore any real network call to
 * Cloudflare R2 — is never constructed during the HTTP integration test
 * suite. Object bytes live entirely in an in-memory map; `seedObject`
 * simulates "the browser already PUT the file" for confirm-route tests.
 */
export class FakeR2ImageStorageClient implements R2ImageStorageClient {
  private objects = new Map<string, { bytes: Buffer; lastModified: Date }>()
  public readonly presignCalls: Array<{ key: string; contentType: string; expiresInSeconds: number }> = []
  public readonly getCalls: string[] = []
  public readonly putCalls: Array<{ key: string; contentType: string; contentLength: number }> = []
  public readonly headCalls: string[] = []
  public readonly deleteCalls: string[] = []

  seedObject(key: string, bytes: Buffer): void {
    this.objects.set(key, { bytes, lastModified: new Date() })
  }

  async createPresignedPutUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedUpload> {
    this.presignCalls.push(input)
    return {
      uploadUrl: `https://fake-r2.invalid/${input.key}`,
      requiredHeaders: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    }
  }

  async getObject(key: string): Promise<FetchedObject> {
    this.getCalls.push(key)
    const entry = this.objects.get(key)
    if (!entry) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "fake object not found")
    }
    return { bytes: entry.bytes, byteSize: entry.bytes.length, contentType: null }
  }

  async putObject(input: { key: string; body: Buffer; contentType: string; contentLength: number }): Promise<void> {
    this.putCalls.push({ key: input.key, contentType: input.contentType, contentLength: input.contentLength })
    this.objects.set(input.key, { bytes: input.body, lastModified: new Date() })
  }

  async headObject(key: string): Promise<{ lastModified: Date; size: number }> {
    assertManagedKey(key)
    this.headCalls.push(key)
    const entry = this.objects.get(key)
    if (!entry) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "fake object not found")
    }
    return { lastModified: entry.lastModified, size: entry.bytes.length }
  }

  async deleteObject(key: string): Promise<void> {
    assertManagedKey(key)
    this.deleteCalls.push(key)
    this.objects.delete(key)
  }

  async listObjects(input: { prefix: string; continuationToken?: string; maxKeys?: number }): Promise<ListObjectsPage> {
    assertManagedPrefix(input.prefix)
    const objects = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(input.prefix))
      .map(([key, entry]) => ({ key, lastModified: entry.lastModified, size: entry.bytes.length }))
    return { objects }
  }
}

/** In-memory eBay adapter: full-app HTTP tests can exercise OAuth without network access. */
export class FakeEbayOAuthClient implements EbayOAuthClient {
  public readonly exchangeCalls: string[] = []
  public readonly identityCalls: string[] = []
  public readonly refreshCalls: string[] = []
  public readonly revokeCalls: string[] = []
  public accessToken = "http-test-access-token-sentinel"
  public refreshToken = "http-test-refresh-token-sentinel"
  public accountId = "http-test-ebay-account"
  public failNextExchange = false
  public failNextIdentity = false
  public failNextRefresh = false
  public failNextRevoke = false
  private identityPause: { started: () => void; wait: Promise<void> } | null = null
  private refreshPause: { started: () => void; wait: Promise<void> } | null = null
  private revokePause: { started: () => void; wait: Promise<void> } | null = null

  pauseNextIdentity(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.identityPause = { started: markStarted, wait }
    return { started, release }
  }

  pauseNextRefresh(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.refreshPause = { started: markStarted, wait }
    return { started, release }
  }

  pauseNextRevoke(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.revokePause = { started: markStarted, wait }
    return { started, release }
  }

  exchangeAuthorisationCode: EbayOAuthClient["exchangeAuthorisationCode"] = async (_config, code, correlationId) => {
    this.exchangeCalls.push(code)
    if (this.failNextExchange) {
      this.failNextExchange = false
      throw new EbayRemoteError("OAUTH_REJECTED", correlationId ?? "http-test-exchange-correlation")
    }
    return {
      token: { access_token: this.accessToken, refresh_token: this.refreshToken, expires_in: 7200, token_type: "User Access Token" },
      correlationId: correlationId ?? "http-test-exchange-correlation",
    }
  }

  getIdentity: EbayOAuthClient["getIdentity"] = async (_config, accessToken, correlationId) => {
    this.identityCalls.push(accessToken)
    if (this.identityPause) {
      const pause = this.identityPause
      this.identityPause = null
      pause.started()
      await pause.wait
    }
    if (this.failNextIdentity) {
      this.failNextIdentity = false
      throw new EbayRemoteError("IDENTITY_REJECTED", correlationId ?? "http-test-identity-correlation")
    }
    return {
      identity: { userId: this.accountId, username: "HTTP test seller" },
      correlationId: correlationId ?? "http-test-identity-correlation",
    }
  }

  refreshUserAccessToken: EbayOAuthClient["refreshUserAccessToken"] = async (_config, refreshToken, correlationId) => {
    this.refreshCalls.push(refreshToken)
    if (this.refreshPause) {
      const pause = this.refreshPause
      this.refreshPause = null
      pause.started()
      await pause.wait
    }
    if (this.failNextRefresh) {
      this.failNextRefresh = false
      throw new EbayRemoteError("REMOTE_UNAVAILABLE", correlationId ?? "http-test-refresh-correlation")
    }
    return {
      token: { access_token: this.accessToken, expires_in: 7200, token_type: "User Access Token" },
      correlationId: correlationId ?? "http-test-refresh-correlation",
    }
  }

  revokeRefreshToken: EbayOAuthClient["revokeRefreshToken"] = async (_config, refreshToken, correlationId) => {
    this.revokeCalls.push(refreshToken)
    if (this.revokePause) {
      const pause = this.revokePause
      this.revokePause = null
      pause.started()
      await pause.wait
    }
    if (this.failNextRevoke) {
      this.failNextRevoke = false
      throw new EbayRemoteError("REMOTE_UNAVAILABLE", correlationId ?? "http-test-revoke-correlation")
    }
    return { correlationId: correlationId ?? "http-test-revoke-correlation" }
  }
}
