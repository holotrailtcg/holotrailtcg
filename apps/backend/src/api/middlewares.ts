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
  ],
})
