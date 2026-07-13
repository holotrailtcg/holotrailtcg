# 0004 — Coming-soon UI boundaries (adapter, consent, routing)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Stage:** 2B (coming-soon user interface)

## Context

Stage 2B builds the coming-soon page, privacy placeholder, custom 404, social
links and cookie-consent UI, reusing the Stage 2A design system. It must not
implement the newsletter backend (Stage 2C), analytics (Stage 2E) or route
gating (Stage 2D), yet it must leave clean seams for them.

## Decisions

### Newsletter form adapter boundary

The form talks to a `NewsletterAdapter` interface, never to a backend directly.
A development-safe placeholder (`dev-adapter.ts`) provides realistic UI states
(loading/success/error) and a duplicate-safe success while persisting nothing.
Stage 2C swaps one export (`newsletterAdapter`) for a real API adapter without
touching the form. Validation lives in pure helpers reusable server-side.

### Consent-state abstraction

Consent is modelled as `ConsentState` with `essential: true` and
`analytics: boolean`, defaulting analytics to **rejected**. Pure store helpers
persist the decision in `localStorage` (`ht_consent`) and are SSR-safe. The UI
loads no analytics; Stage 2E reads this state to decide whether to enable GA4.
There is no marketing category because no marketing cookies are used.

### Top-level routes; middleware deferred to Stage 2D

`/coming-soon`, `/privacy` and the custom 404 are top-level, locale-independent
routes. The DTC Starter `middleware.ts` currently prepends a country code to
every path (so `/coming-soon` → `/gb/coming-soon`). We deliberately **do not**
modify middleware in this stage — Stage 2D owns which routes return the
coming-soon experience. The pages were verified to render by temporarily
bypassing middleware locally (not committed).

> **Amended in Stage 2B review (2026-07-13).** Bypassing the middleware to verify
> the pages hid a real defect: with the real middleware enabled, `/coming-soon`
> and `/privacy` redirected to `/gb/coming-soon` and `/gb/privacy`, which had no
> matching routes and returned 404. The fix adds country-aware entry points
> under `[countryCode]/coming-soon` and `[countryCode]/privacy` that render
> shared views (`components/coming-soon/coming-soon-view.tsx`,
> `components/privacy/privacy-view.tsx`), and makes internal links locale-aware.
> The middleware itself is unchanged and **no Stage 2D route protection** was
> added. Route-aware tests now run against the real middleware
> (`middleware.test.ts`).

### Vitest for storefront unit tests

The storefront had no test runner. We added Vitest (node environment) for the
pure helpers and content configuration only. No jsdom/RTL/component-render
tests were added; that is heavier infrastructure not justified at this stage.

### Bespoke social icons, not a new library

Facebook/Instagram glyphs are small inline `currentColor` SVGs (like the
starter's `modules/common/icons`), not a new icon dependency. `@medusajs/icons`
remains the storefront icon convention.

## Consequences

- Stage 2C: replace `newsletterAdapter` and add the API route + validation reuse.
- Stage 2D: update middleware to serve/gate the coming-soon experience.
- Stage 2E: read consent state to conditionally load GA4.
- A real hero image can be dropped at
  `public/images/coming-soon/hero-placeholder.webp` with no code change.
