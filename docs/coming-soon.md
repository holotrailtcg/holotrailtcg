# Coming-soon interface (Stage 2B)

The pre-launch coming-soon UI, built entirely on the Stage 2A design system.
This stage is **UI only** — there is no subscriber database, newsletter API,
Resend, reCAPTCHA, rate limiting, analytics or route gating yet.

## Structure

Routes (`apps/storefront/src/app`):

| Route            | File                          | Notes                                   |
| ---------------- | ----------------------------- | --------------------------------------- |
| `/coming-soon`   | `coming-soon/page.tsx`        | Server component; composes the page     |
| `/privacy`       | `privacy/page.tsx`            | Placeholder to prevent a broken link    |
| custom 404       | `not-found.tsx`               | Branded app-level not-found             |

Feature components (`apps/storefront/src/components`):

- `coming-soon/newsletter-form.tsx` — the page's **single client island** (form state).
- `coming-soon/hero-visual.tsx` — server component; image area with branded fallback.
- `brand/social-links.tsx` + `brand/icons/{facebook,instagram}.tsx` — reusable social links.
- `privacy/cookie-consent.tsx` — reusable cookie-consent UI (client).

The page is primarily server-rendered; only the newsletter form and the cookie
banner are client components. Shared Stage 2A primitives are reused throughout
(`PageShell`, `ContentContainer`, `Section`, `BrandLogo`, `Button`, `Input`,
`Label`, `Checkbox`, `FormField`, `Alert`). No `coming-soon-button`,
`coming-soon-input` or `coming-soon-alert` were created.

## Content configuration location

All replaceable copy and social configuration lives in one place —
`apps/storefront/src/content`:

- `content/coming-soon.ts` — hero copy, benefits, form labels, consent wording,
  success/error wording, privacy-note copy. No launch date; no urgency/scarcity.
- `content/social.ts` — Facebook and Instagram URLs and accessible labels.

Presentational components must not embed page copy — import it from here.

## Image placeholder

`hero-visual.tsx` looks for:

    apps/storefront/public/images/coming-soon/hero-placeholder.webp

If present it leads (via `next/image`). If absent, an intentional branded navy
panel with the icon mark and a signal trail renders instead — never a broken
image, never invented product photography. See
`public/images/coming-soon/README.md`.

## Form adapter boundary (Stage 2C integration point)

The form depends only on a `NewsletterAdapter` interface — never on a backend,
DB or email provider directly. Files in `apps/storefront/src/lib/newsletter`:

- `types.ts` — `NewsletterSubmission`, `NewsletterResult`, `NewsletterAdapter`.
- `validation.ts` — pure, reusable validators (first-name length, email format,
  consent required). Shared by the UI now and available to the Stage 2C route.
- `dev-adapter.ts` — **development-safe placeholder**. Simulates latency and
  returns a duplicate-safe success. Persists nothing, calls nothing, sends
  nothing. Never claims an email was sent.
- `index.ts` — exports `newsletterAdapter` (currently the dev adapter). **This
  is the single swap point for Stage 2C**: replace it with an adapter that POSTs
  to the storefront API route and the form UI is unchanged.

## Cookie-consent UI state (Stage 2E integration point)

Files in `apps/storefront/src/lib/consent`:

- `types.ts` — `ConsentState`, `ConsentCategories` (`essential: true`,
  `analytics: boolean`), `DEFAULT_CONSENT` (analytics **rejected** by default),
  `CONSENT_VERSION`.
- `store.ts` — pure, SSR-safe helpers: `parseConsent`, `serializeConsent`,
  `decideConsent`, `readConsent`, `writeConsent` (localStorage key `ht_consent`).

The `CookieConsent` component:

- shows a banner until an explicit choice is made;
- offers **Accept analytics** and **Reject analytics** as equal, adjacent,
  single-click actions (no dark pattern; reject is as easy as accept);
- keeps essential cookies always on; has **no marketing category**;
- exposes an always-available "Cookie preferences" control to change the choice;
- is keyboard operable (focus moves to the dialog on open; Escape closes it once
  a decision exists);
- persists the choice locally only. **It does not load Google Analytics.**
  Stage 2E reads the stored consent to decide whether to enable GA4.

This cookie system has **not** been legally reviewed.

## Privacy placeholder

`/privacy` uses the design system, states clearly that the full privacy notice
is being prepared, invents no legal terms and claims no compliance, and links
back to the coming-soon page.

## Custom 404

`not-found.tsx` is a calm, branded app-level not-found using `PageShell`,
`ContentContainer` and `BrandLogo`, with a link back to `/coming-soon`. It does
**not** implement coming-soon route protection — Stage 2D controls which routes
return which experience.

## Routing note (for Stage 2D)

The coming-soon, privacy and 404 pages are top-level (locale-independent). The
DTC Starter `middleware.ts` currently prepends a country code to every path, so
`/coming-soon` 307-redirects to `/gb/coming-soon`. Stage 2D owns middleware and
must decide how the coming-soon experience is served/gated. This stage does not
modify middleware.

## Assets Scott must supply

- `public/images/coming-soon/hero-placeholder.webp` — approved, royalty-free,
  collector/card-related hero image (optional; a branded fallback renders
  without it).
- Brand logos are already supplied (`public/brand/holotrailtcg-*.png`) and wired
  into `BrandLogo`.

## Tests

`apps/storefront` now runs Vitest (`pnpm --filter @dtc/storefront test`):

- `lib/newsletter/validation.test.ts` — validation helpers.
- `lib/consent/store.test.ts` — consent-state helpers.
- `content/content.test.ts` — coming-soon copy and social configuration.

Component/DOM render tests are out of scope for this stage (no jsdom/RTL added).
