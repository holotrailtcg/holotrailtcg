# 0006 — Stage 2D route gating (allowlist, fail-closed default)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Stage:** 2D (coming-soon route gating)

## Context

Stage 2B/2C built the coming-soon experience and the newsletter backend but
deliberately deferred route protection — see
[0004](0004-coming-soon-ui-boundaries.md), which records "Stage 2D: update
middleware to serve/gate the coming-soon experience" as an explicit,
planned consequence. Until this stage, the full Medusa DTC storefront
(`store`, `products`, `collections`, `categories`, `cart`, `checkout`,
`account`, `order`) was fully built and reachable by typing a URL directly —
nothing prevented a visitor from browsing the unfinished store before
launch.

## Decision

### Environment variable: fail closed on anything but exact `"false"`

`COMING_SOON_MODE` is evaluated server-side on every middleware invocation
(not cached or read once at startup), via a pure resolver
(`apps/storefront/src/lib/coming-soon/config.ts`):

- Exact string `"true"` → gated.
- Exact string `"false"` → not gated.
- Anything else (unset, empty, `"TRUE"`, `"1"`, a typo) → gated.

This mirrors the exact-string-match convention already used elsewhere in the
repo (`MEDUSA_ADMIN_DISABLE`, `NEWSLETTER_TRUST_PROXY`), but inverts which
side is the "safe default": those variables default to their less invasive
behaviour when malformed (admin stays enabled, proxy trust stays off).
`COMING_SOON_MODE` is different because the store being **reachable** is the
higher-risk state pre-launch, not the lower-risk one — so an unset or
mistyped variable must never accidentally expose the unfinished store. This
also means local development requires deliberately setting
`COMING_SOON_MODE=false` to see the real storefront, which is intentional.

Not `NEXT_PUBLIC_`-prefixed: it is read only in `middleware.ts` (server/edge
execution) and never needs to reach the browser bundle.

### Route policy: allowlist, not a blocklist

`apps/storefront/src/lib/coming-soon/allowlist.ts` lists the only routes
that remain reachable while gated: `/coming-soon`, `/privacy`,
`/newsletter/confirm`, `/newsletter/unsubscribe` (each matched after
stripping any `/{countryCode}` prefix). Everything else redirects.

An allowlist was chosen over enumerating every store/product/checkout route
because the brief explicitly asked to avoid a manually maintained list of
every future product URL. With an allowlist, any new commerce route added in
a later stage (search, wishlist, a new account page, etc.) is gated
automatically with zero changes to this code — the default is "hidden until
proven safe," not "hidden until someone remembers to add it to a list."

One consequence: an unknown or mistyped path under a country prefix (e.g. a
future route added without updating anything, or a genuine 404) also
redirects to the coming-soon page rather than rendering the app's real
not-found page while gated. This is accepted as the safer default — see
Consequences.

### Middleware integration, not a new layer

The gate is one conditional block added to the existing
`apps/storefront/src/middleware.ts`, placed after the existing newsletter
token-redirect special case and country-code resolution, before the existing
country-prefix redirect/pass-through branch. It reuses the existing
`redirectWithoutBody` helper and the already-resolved, allowlist-validated
`country` value — so the gate can never redirect to an attacker-controlled
destination (no open-redirect surface) and always redirects in exactly one
hop, whether or not the original request already had a country prefix. No
query string is forwarded to the coming-soon page (no genuine need to
preserve one, and it avoids carrying arbitrary commerce query strings
forward).

A defensive `/_next/` prefix early-return was added alongside the existing
dotted-path early-return, even though the current `config.matcher` already
excludes `_next/static` and `_next/image` from ever invoking the middleware
in production — this is defence in depth for any other `_next/*` subpath.

### Out of scope

- Medusa backend, Admin, and the Store API are not gated — only the
  storefront's page routes. Per the brief, backend/Admin gating is
  explicitly out of scope for Stage 2D.
- `apps/storefront/next-sitemap.js` is orphaned (not an installed
  dependency, not wired into any build script) and generates no
  robots.txt/sitemap.xml today. It is left untouched — nothing is currently
  exposed through it, so there is nothing for the gate to protect against
  here. Newsletter confirm/unsubscribe pages already set
  `robots: { index: false, follow: false }` in their page metadata; no
  change was needed there either.

## Consequences

- Developers must set `COMING_SOON_MODE=false` locally to reach the normal
  DTC storefront; this is documented in `.env.template` and
  `docs/operations/environment-variables.md`.
- A visitor hitting any non-allowlisted URL while gated — including a
  genuine typo — sees the branded coming-soon page instead of the app's
  normal 404. This is consistent with "the unfinished store must not be
  publicly accessible" and avoids the maintenance burden CLAUDE.md and the
  brief both flagged.
- If a future stage adds a sitemap/robots implementation, it should be
  reviewed against `COMING_SOON_MODE` at that time — flagged here, not
  solved now, since no such implementation exists yet.

## Amendment (2026-07-13)

The original implementation exempted any path containing a `.` from all
middleware policy, intending to skip static assets. That check also matched
legitimate application routes containing a dot (e.g.
`/gb/products/card.v2`, `/gb/order/.../transfer/a.b.c`), letting them bypass
the coming-soon gate entirely. It was replaced with an explicit,
narrowly-matched static-asset allowlist
(`apps/storefront/src/lib/static-assets.ts`) keyed on real file/directory
names (`favicon.ico`, `opengraph-image.jpg`, `twitter-image.jpg`, and the
public asset directories actually used by the storefront), not on file
extension. See `apps/storefront/src/middleware.test.ts` for the regression
coverage and `apps/storefront/scripts/verify-coming-soon-gate.mjs` for the
real-HTTP verification.
