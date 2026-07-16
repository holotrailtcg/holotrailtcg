import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import { subscribeBodySchema } from "./store/newsletter/shared/validation"
import { redactNewsletterTokenQueryFromRequestLog } from "./store/newsletter/shared/request-logging"

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
  ],
})
