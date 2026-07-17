import path from "node:path"
import { asValue } from "@medusajs/framework/awilix"
import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { IApiKeyModuleService } from "@medusajs/framework/types"
import {
  NEWSLETTER_RECAPTCHA_VERIFIER_KEY,
  NEWSLETTER_CONFIRMATION_EMAIL_SENDER_KEY,
} from "../../../src/api/store/newsletter/shared/dependencies"
import { TCGDEX_ADMIN_CLIENT_KEY } from "../../../src/api/admin/tcgdex/dependencies"
import { R2_IMAGE_STORAGE_CLIENT_KEY } from "../../../src/api/admin/trading-cards/dependencies"
import { FakeRecaptchaVerifier, FakeConfirmationEmailSender, FakeTcgDexClient, FakeR2ImageStorageClient } from "./fakes"

/**
 * HTTP integration test bootstrap for the public newsletter routes
 * (Stage 2C.6). See docs/decisions/0005-newsletter-backend-design.md for
 * the full write-up; summarised here:
 *
 * `@medusajs/test-utils`'s documented `medusaIntegrationTestRunner` cannot
 * be used — its `dist/medusa-test-runner.js` unconditionally
 * `require()`s `./database`, which itself unconditionally `require()`s
 * `pg-god` at module-load time (used for out-of-band database create/drop
 * against separate `DB_HOST`/`DB_USERNAME` env vars, not the
 * already-guarded `DATABASE_URL`), and `pg-god` is not an installed
 * dependency in this repository — the same issue Stage 2C.2 documented for
 * the module-test runner. This bootstrap instead deep-imports only
 * `@medusajs/test-utils`'s `medusa-test-runner-utils/bootstrap-app`
 * submodule directly (bypassing `dist/index.js` and `dist/medusa-test-runner.js`
 * entirely, so `pg-god` is never required), which starts the real Express
 * app via the same official `@medusajs/medusa/loaders/index` the CLI
 * itself uses and returns an actual listening HTTP server plus the root
 * DI container — no second, ungoverned database create/drop mechanism is
 * introduced; the suite reuses the already-guarded, already-migrated test
 * database exactly as the module-test suite does.
 *
 * Fake reCAPTCHA/Resend/TCGdex adapters are registered directly into the
 * root container immediately after boot, before any request is made, using
 * the exact registration keys `src/api/store/newsletter/shared/dependencies.ts`
 * and `src/api/admin/tcgdex/dependencies.ts` resolve through — this is the
 * "register a fake under the same key before the lazy production
 * registration ever runs" mechanism those modules document. No `NODE_ENV`
 * branch, magic header or magic token makes this reachable in production;
 * it is wired up only here, in the test bootstrap.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startApp } = require("@medusajs/test-utils/dist/medusa-test-runner-utils/bootstrap-app") as {
  startApp(options?: {
    cwd?: string
    env?: Record<string, string>
  }): Promise<{ shutdown: () => Promise<void>; container: MedusaContainer; port: number }>
}

/** Header trusted only inside this test harness — see `rate-limit/client-address.ts`. */
export const TEST_CLIENT_ADDRESS_HEADER = "x-test-client-address"

/** Deliberately small so a dedicated test can exhaust it in a handful of requests. */
export const TEST_RATE_LIMIT_MAX_REQUESTS = 5
export const TEST_RATE_LIMIT_WINDOW_SECONDS = 60

const TEST_ENV_OVERRIDES: Record<string, string> = {
  // No built Admin UI is available in this environment; see medusa-config.ts.
  MEDUSA_ADMIN_DISABLE: "true",
  NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: String(TEST_RATE_LIMIT_WINDOW_SECONDS),
  NEWSLETTER_RATE_LIMIT_MAX_REQUESTS: String(TEST_RATE_LIMIT_MAX_REQUESTS),
  NEWSLETTER_RATE_LIMIT_HASH_SECRET: "http-test-only-newsletter-rate-limit-hmac-secret-not-real",
  NEWSLETTER_TRUST_PROXY: "true",
  NEWSLETTER_TRUSTED_IP_HEADER: TEST_CLIENT_ADDRESS_HEADER,
  RESEND_API_KEY: "http-test-only-resend-api-key-not-real",
  RESEND_FROM_EMAIL: "Holo Trail TCG Test <hello@test.holotrailtcg.invalid>",
  RESEND_REPLY_TO_EMAIL: "support@test.holotrailtcg.invalid",
  PUBLIC_STOREFRONT_URL: "http://localhost:8000",
  // Forced off regardless of the developer's local .env: this suite always
  // registers FakeR2ImageStorageClient directly (see below), and several
  // assertions depend on R2 being unconfigured (e.g. a null `imageUrl` when
  // no public base URL exists). Leaving this to the ambient environment
  // would make those assertions depend on machine-specific local state.
  R2_IMAGES_ENABLED: "false",
  // RECAPTCHA_SECRET_KEY is deliberately left unset: the fake verifier is
  // registered before any request, so the real GoogleRecaptchaVerifier
  // (and its RECAPTCHA_SECRET_KEY requirement) must never be constructed
  // during this suite. If it ever is, `resolveRecaptchaConfig()` throws
  // loudly instead of silently making a real network call.
}

export interface NewsletterHttpTestApp {
  baseUrl: string
  recaptcha: FakeRecaptchaVerifier
  emailSender: FakeConfirmationEmailSender
  tcgdexClient: FakeTcgDexClient
  r2ImageClient: FakeR2ImageStorageClient
  container: MedusaContainer
  close: () => Promise<void>
  /** POST /store/newsletter/subscribe with an optional client-address override header. */
  postSubscribe: (body: unknown, clientAddress?: string) => Promise<Response>
  /** GET /store/newsletter/confirm?token=... */
  getConfirm: (token: string, clientAddress?: string) => Promise<Response>
  /** GET /store/newsletter/unsubscribe?token=... */
  getUnsubscribe: (token: string, clientAddress?: string) => Promise<Response>
  /** POST /admin/trading-cards/variants/:variantId/images/upload */
  postBeginUpload: (variantId: string, body: unknown, authToken?: string) => Promise<Response>
  /** POST /admin/trading-cards/images/:imageId/confirm */
  postConfirmUpload: (imageId: string, authToken?: string) => Promise<Response>
  /** GET /admin/trading-cards/needing-images */
  getNeedingImages: (query: Record<string, string>, authToken?: string) => Promise<Response>
  /** GET /admin/trading-cards/:tradingCardId/images */
  getCardImages: (tradingCardId: string, authToken?: string) => Promise<Response>
  /** POST /admin/trading-cards/variants/:variantId/images/reorder */
  postReorder: (variantId: string, body: unknown, authToken?: string) => Promise<Response>
  /** POST /admin/trading-cards/images/:imageId/archive */
  postArchive: (imageId: string, authToken?: string) => Promise<Response>
  /** POST /admin/trading-cards/images/:imageId/restore */
  postRestore: (imageId: string, authToken?: string) => Promise<Response>
  /** POST /admin/trading-cards/images/:imageId/focal-point */
  postFocalPoint: (imageId: string, body: unknown, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/sources */
  getInventorySources: (query: Record<string, string>, authToken?: string) => Promise<Response>
  /** POST /admin/trading-card-inventory/sources */
  postCreateInventorySource: (body: unknown, authToken?: string) => Promise<Response>
  /** POST /admin/trading-card-inventory/sources/:id/rename */
  postRenameInventorySource: (id: string, body: unknown, authToken?: string) => Promise<Response>
  /** POST /admin/trading-card-inventory/sources/:id/archive */
  postArchiveInventorySource: (id: string, authToken?: string) => Promise<Response>
  /** POST /admin/trading-card-inventory/sources/:id/restore */
  postRestoreInventorySource: (id: string, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/sources/:id/summary */
  getInventorySourceSummary: (id: string, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/transactions */
  getInventoryTransactions: (query: Record<string, string>, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/proposals */
  getInventoryProposals: (query: Record<string, string>, authToken?: string) => Promise<Response>
  getInventoryProposal: (id: string, query?: Record<string, string>, authToken?: string) => Promise<Response>
  postReviewInventoryProposal: (id: string, body: unknown, authToken?: string) => Promise<Response>
  postBulkReviewInventoryProposals: (body: unknown, authToken?: string) => Promise<Response>
  postApplyInventoryProposal: (id: string, authToken?: string) => Promise<Response>
  postBulkApplyInventoryProposals: (body: unknown, authToken?: string) => Promise<Response>
  postRetryInventoryProposalSync: (id: string, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/proposals/summary */
  getInventoryProposalSummary: (query: Record<string, string>, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/snapshots/:id/reconciliation-summary */
  getInventoryReconciliationSummary: (id: string, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/variants/:variantId/publish-readiness */
  getPublishReadiness: (variantId: string, authToken?: string) => Promise<Response>
  /** POST /admin/trading-card-inventory/imports/upload (multipart) */
  postUploadCsv: (
    file: { content: string; filename: string; mimeType: string },
    fields: Record<string, string>,
    authToken?: string,
  ) => Promise<Response>
  /** GET /admin/trading-card-inventory/imports/snapshots/:id/summary */
  getImportSnapshotSummary: (id: string, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/imports/snapshots/:id/entries */
  getImportSnapshotEntries: (id: string, query: Record<string, string>, authToken?: string) => Promise<Response>
  /** GET /admin/trading-card-inventory/imports/snapshots/:id/diagnostics */
  getImportSnapshotDiagnostics: (id: string, query: Record<string, string>, authToken?: string) => Promise<Response>
  /** POST /admin/trading-card-inventory/imports/snapshots/:id/retry-matching */
  postRetryMatching: (id: string, body: unknown, authToken?: string) => Promise<Response>
  /** POST /admin/trading-card-inventory/imports/snapshots/:id/reconcile */
  postReconcileSnapshot: (id: string, body: unknown, authToken?: string) => Promise<Response>
}

/**
 * Every Medusa Store API route — including the newsletter routes, which
 * live under `/store/newsletter/*` — requires a valid publishable API key
 * in the `x-publishable-api-key` header (Medusa's own
 * `ensurePublishableApiKeyMiddleware`, applied globally to `/store`, not
 * something this stage opts into or could opt out of). Production callers
 * use the same `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` the rest of the
 * storefront already uses; this test harness creates one real, valid
 * publishable key directly via the API Key module service (no different
 * from how an operator would create one in Admin) so requests satisfy that
 * standard Medusa contract, and removes it again on `close()`.
 */
async function createTestPublishableApiKey(container: MedusaContainer): Promise<{
  token: string
  remove: () => Promise<void>
}> {
  const apiKeyModuleService = container.resolve<IApiKeyModuleService>(Modules.API_KEY)
  const apiKey = await apiKeyModuleService.createApiKeys({
    title: "newsletter-http-test",
    type: "publishable",
    created_by: "newsletter-http-test-harness",
  })
  return {
    token: apiKey.token,
    remove: async () => {
      await apiKeyModuleService.revoke(apiKey.id, {
        revoked_by: "newsletter-http-test-harness",
      })
      await apiKeyModuleService.deleteApiKeys([apiKey.id])
    },
  }
}

// Seeded with a random offset (rather than 0) so two test *processes*
// started within the same fixed rate-limit window never regenerate the
// same address sequence and silently share a bucket left over from a
// previous run against the same (persistent) test database.
let testAddressCounter = Math.floor(Math.random() * 10_000_000)

/** A fresh, syntactically valid IPv4 address, unique per call, so unrelated test cases never share a rate-limit bucket unless they deliberately reuse the same address. */
export function nextTestClientAddress(): string {
  testAddressCounter += 1
  const a = 10
  const b = Math.floor(testAddressCounter / 65536) % 256
  const c = Math.floor(testAddressCounter / 256) % 256
  const d = testAddressCounter % 256
  return `${a}.${b}.${c}.${d}`
}

export async function bootstrapNewsletterHttpTestApp(): Promise<NewsletterHttpTestApp> {
  const cwd = path.resolve(__dirname, "../../..")

  const { shutdown, container, port } = await startApp({
    cwd,
    env: TEST_ENV_OVERRIDES,
  })

  const recaptcha = new FakeRecaptchaVerifier()
  const emailSender = new FakeConfirmationEmailSender()
  const tcgdexClient = new FakeTcgDexClient()
  const r2ImageClient = new FakeR2ImageStorageClient()
  container.register(NEWSLETTER_RECAPTCHA_VERIFIER_KEY, asValue(recaptcha))
  container.register(NEWSLETTER_CONFIRMATION_EMAIL_SENDER_KEY, asValue(emailSender))
  container.register(TCGDEX_ADMIN_CLIENT_KEY, asValue(tcgdexClient))
  container.register(R2_IMAGE_STORAGE_CLIENT_KEY, asValue(r2ImageClient))

  const publishableApiKey = await createTestPublishableApiKey(container)

  const baseUrl = `http://localhost:${port}`

  function withHeaders(clientAddress?: string): Record<string, string> {
    return {
      "x-publishable-api-key": publishableApiKey.token,
      ...(clientAddress ? { [TEST_CLIENT_ADDRESS_HEADER]: clientAddress } : {}),
    }
  }

  return {
    baseUrl,
    recaptcha,
    emailSender,
    tcgdexClient,
    r2ImageClient,
    container,
    close: async () => {
      await publishableApiKey.remove()
      await shutdown()
    },
    postSubscribe: (body, clientAddress) =>
      fetch(`${baseUrl}/store/newsletter/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...withHeaders(clientAddress ?? nextTestClientAddress()),
        },
        body: JSON.stringify(body),
      }),
    getConfirm: (token, clientAddress) =>
      fetch(`${baseUrl}/store/newsletter/confirm?token=${encodeURIComponent(token)}`, {
        headers: withHeaders(clientAddress ?? nextTestClientAddress()),
      }),
    getUnsubscribe: (token, clientAddress) =>
      fetch(`${baseUrl}/store/newsletter/unsubscribe?token=${encodeURIComponent(token)}`, {
        headers: withHeaders(clientAddress ?? nextTestClientAddress()),
      }),
    postBeginUpload: (variantId, body, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/variants/${encodeURIComponent(variantId)}/images/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    postConfirmUpload: (imageId, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/images/${encodeURIComponent(imageId)}/confirm`, {
        method: "POST",
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getNeedingImages: (query, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/needing-images?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getCardImages: (tradingCardId, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/${encodeURIComponent(tradingCardId)}/images`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postReorder: (variantId, body, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/variants/${encodeURIComponent(variantId)}/images/reorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    postArchive: (imageId, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/images/${encodeURIComponent(imageId)}/archive`, {
        method: "POST",
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postRestore: (imageId, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/images/${encodeURIComponent(imageId)}/restore`, {
        method: "POST",
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postFocalPoint: (imageId, body, authToken) =>
      fetch(`${baseUrl}/admin/trading-cards/images/${encodeURIComponent(imageId)}/focal-point`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    getInventorySources: (query, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/sources?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postCreateInventorySource: (body, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/sources`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    postRenameInventorySource: (id, body, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/sources/${encodeURIComponent(id)}/rename`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    postArchiveInventorySource: (id, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/sources/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postRestoreInventorySource: (id, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/sources/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getInventorySourceSummary: (id, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/sources/${encodeURIComponent(id)}/summary`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getInventoryTransactions: (query, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/transactions?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getInventoryProposals: (query, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getInventoryProposal: (id, query = {}, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals/${encodeURIComponent(id)}?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postReviewInventoryProposal: (id, body, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals/${encodeURIComponent(id)}/review`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify(body),
      }),
    postBulkReviewInventoryProposals: (body, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals/review`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify(body),
      }),
    postApplyInventoryProposal: (id, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals/${encodeURIComponent(id)}/apply`, {
        method: "POST", headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postBulkApplyInventoryProposals: (body, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals/apply`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify(body),
      }),
    postRetryInventoryProposalSync: (id, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals/${encodeURIComponent(id)}/retry-sync`, {
        method: "POST", headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getInventoryProposalSummary: (query, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/proposals/summary?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getInventoryReconciliationSummary: (id, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/snapshots/${encodeURIComponent(id)}/reconciliation-summary`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getPublishReadiness: (variantId, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/variants/${encodeURIComponent(variantId)}/publish-readiness`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postUploadCsv: (file, fields, authToken) => {
      const formData = new FormData()
      formData.append("file", new Blob([file.content], { type: file.mimeType }), file.filename)
      for (const [key, value] of Object.entries(fields)) formData.append(key, value)
      return fetch(`${baseUrl}/admin/trading-card-inventory/imports/upload`, {
        method: "POST",
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
        body: formData,
      })
    },
    getImportSnapshotSummary: (id, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(id)}/summary`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getImportSnapshotEntries: (id, query, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(id)}/entries?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    getImportSnapshotDiagnostics: (id, query, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(id)}/diagnostics?${new URLSearchParams(query).toString()}`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      }),
    postRetryMatching: (id, body, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(id)}/retry-matching`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body ?? {}),
      }),
    postReconcileSnapshot: (id, body, authToken) =>
      fetch(`${baseUrl}/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(id)}/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body ?? {}),
      }),
  }
}
