import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import { subscribeBodySchema } from "./store/newsletter/shared/validation"
import { redactNewsletterTokenQueryFromRequestLog } from "./store/newsletter/shared/request-logging"
import { redactEbayCallbackQueryFromRequestLog } from "./admin/ebay/connections/callback/request-logging"
import { observeEbayCallbackUrlAtCompletion } from "./admin/ebay/connections/callback/test-completion-observer"
import { pulseCsvUploadMiddleware } from "./admin/trading-card-inventory/imports/upload-middleware"

/**
 * Route-level middleware for the public newsletter routes (Stage 2C.6, see
 * docs/decisions/0005-newsletter-backend-design.md). `POST
 * /store/newsletter/subscribe` accepts JSON only, bounded to a small,
 * conservative body size — no image or file field ever reaches this route,
 * so a generous-but-bounded limit is sufficient to reject an oversized
 * request before it is parsed. `validateAndTransformBody` runs the strict
 * zod schema and populates `req.validatedBody`; a request with an
 * unsupported `Content-Type` (Medusa's JSON body parser only populates a
 * body for `application/json`) fails the same schema validation as a
 * missing body, so no separate content-type branch is needed.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/newsletter/subscribe",
      methods: ["POST"],
      bodyParser: { sizeLimit: "10kb" },
      middlewares: [validateAndTransformBody(subscribeBodySchema)],
    },
    {
      matcher: "/store/newsletter/confirm",
      methods: ["GET"],
      middlewares: [redactNewsletterTokenQueryFromRequestLog],
    },
    {
      matcher: "/store/newsletter/unsubscribe",
      methods: ["GET"],
      middlewares: [redactNewsletterTokenQueryFromRequestLog],
    },
    // Stage 4A.4.3 TCGdex Admin review actions: no route accepts enrichment
    // data, only a proposal/card ID and (for reject) a short reason, so a
    // small conservative body limit is enough without a dedicated schema
    // middleware — each route already validates its own body with zod.
    {
      matcher: "/admin/tcgdex/reviews/*/approve",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    {
      matcher: "/admin/tcgdex/reviews/*/reject",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    {
      matcher: "/admin/tcgdex/reviews/*/apply",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    {
      matcher: "/admin/tcgdex/cards/*/retry",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    // Stage 4B.2 card-image upload/confirm: no image bytes ever pass
    // through this backend — the browser PUTs directly to R2 using the
    // presigned URL these routes return, so both request bodies stay tiny.
    // The upload-request body carries only a filename/MIME/size; the
    // confirm route accepts no body at all.
    {
      matcher: "/admin/trading-cards/variants/*/images/upload",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    {
      matcher: "/admin/trading-cards/images/*/confirm",
      methods: ["POST"],
      bodyParser: { sizeLimit: "1kb" },
    },
    // Stage 5A.1 inventory-source management: small bounded bodies only
    // (display name, provider, language, a handful of short reserved config
    // fields) — no CSV or bulk payload ever reaches these routes.
    {
      matcher: "/admin/trading-card-inventory/sources",
      methods: ["POST"],
      bodyParser: { sizeLimit: "5kb" },
    },
    {
      matcher: "/admin/trading-card-inventory/sources/*/rename",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    {
      matcher: "/admin/trading-card-inventory/sources/*/archive",
      methods: ["POST"],
      bodyParser: { sizeLimit: "1kb" },
    },
    {
      matcher: "/admin/trading-card-inventory/sources/*/restore",
      methods: ["POST"],
      bodyParser: { sizeLimit: "1kb" },
    },
    // Stage 5B.1 Slice 3 Pulse CSV upload: this is the first multipart route
    // in this backend. Medusa's built-in JSON body parser is disabled for
    // this exact path so Multer can read the raw multipart stream itself;
    // Multer is configured with `memoryStorage()` and a 10 MB limit (see
    // `imports/upload-middleware.ts`) — no temp file, no filesystem path, no
    // R2. Everything else about the uploaded bytes (extension, MIME,
    // content) is validated by the import workflow, not here.
    {
      matcher: "/admin/trading-card-inventory/imports/upload",
      methods: ["POST"],
      bodyParser: false,
      middlewares: [pulseCsvUploadMiddleware],
    },
    // Small bounded JSON bodies only (an optional free-text reason, and for
    // reconcile an optional baseline snapshot id) — no CSV or bulk payload.
    {
      matcher: "/admin/trading-card-inventory/imports/snapshots/*/retry-matching",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    {
      matcher: "/admin/trading-card-inventory/imports/snapshots/*/reconcile",
      methods: ["POST"],
      bodyParser: { sizeLimit: "2kb" },
    },
    // Stage E1 eBay connection lifecycle: bounded control payloads only.
    // OAuth codes arrive on the GET callback and are never body-parsed.
    {
      matcher: "/admin/ebay/connections",
      methods: ["POST"],
      bodyParser: { sizeLimit: "1kb" },
    },
    {
      matcher: "/admin/ebay/connections/disconnect",
      methods: ["POST"],
      bodyParser: { sizeLimit: "1kb" },
    },
    // E2A1 Store-category controls are JSON only. CSV bytes are held only in
    // the request and parsed for preview/application; they are never stored.
    {
      matcher: "/admin/ebay/store-categories*",
      methods: ["POST"],
      bodyParser: { sizeLimit: "1100kb" },
    },
    // The unauthenticated OAuth callback must retain its query for validation,
    // but Medusa's access logger must never see its code, state, or error.
    {
      // Test-only completion observer for an unrelated Admin route. The real
      // HTTP test proves the callback matcher below is the only route whose
      // access-log-visible originalUrl is changed.
      matcher: "/admin/ebay/connections",
      methods: ["GET"],
      middlewares: process.env.NODE_ENV === "test" && process.env.EBAY_TEST_CAPTURE_CALLBACK_LOG === "true"
        ? [observeEbayCallbackUrlAtCompletion]
        : [],
    },
    {
      // Cover the whole dynamic callback namespace, including an invalid
      // environment segment that the route rejects. Its query can still hold
      // OAuth-shaped values and must never reach completion-time access logs.
      matcher: "/admin/ebay/connections/callback/*",
      methods: ["GET"],
      middlewares: process.env.NODE_ENV === "test" && process.env.EBAY_TEST_CAPTURE_CALLBACK_LOG === "true"
        ? [observeEbayCallbackUrlAtCompletion, redactEbayCallbackQueryFromRequestLog]
        : [redactEbayCallbackQueryFromRequestLog],
    },
  ],
})
