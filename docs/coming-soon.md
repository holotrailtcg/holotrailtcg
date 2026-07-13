# Coming-soon interface (Stage 2B)

The pre-launch coming-soon UI, built entirely on the Stage 2A design system.
This stage is **UI only** — there is no subscriber database, newsletter API,
Resend, reCAPTCHA, rate limiting, analytics or route gating yet.

## Structure

Routes (`apps/storefront/src/app`):

| Route                     | File                                | Notes                                             |
| ------------------------- | ----------------------------------- | ------------------------------------------------- |
| `/{country}/coming-soon`  | `[countryCode]/coming-soon/page.tsx`| Country-aware entry point; renders `ComingSoonView`|
| `/{country}/privacy`      | `[countryCode]/privacy/page.tsx`    | Country-aware entry point; renders `PrivacyView`  |
| custom 404                | `not-found.tsx`                     | Branded global not-found (returns a 404)          |

The entry points are thin: the page presentation lives in shared views
(`components/coming-soon/coming-soon-view.tsx`,
`components/privacy/privacy-view.tsx`) so it is defined once. The country-code
middleware redirects `/coming-soon` → `/{country}/coming-soon` (and likewise for
`/privacy`), so these routes work through the existing middleware. Internal
links (home, privacy, and the form's privacy link) are locale-aware, built from
the resolved `countryCode`.

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

`not-found.tsx` is a calm, branded global not-found using `PageShell`,
`ContentContainer` and `BrandLogo`. It returns a genuine 404 response. Its
return link points at the unprefixed `/coming-soon`; because the global
not-found renders outside the `[countryCode]` segment there is no locale to read
here, so the country-code middleware localises the link to
`/{country}/coming-soon`. The button uses the shared `buttonVariants` rather than
copied classes. It does **not** implement coming-soon route protection — Stage 2D
controls which routes return which experience.

## Routing note (for Stage 2D)

The coming-soon and privacy pages have country-aware entry points under
`[countryCode]`, so the country-code middleware's redirect (`/coming-soon` →
`/{country}/coming-soon`) resolves to a working page. This stage does not change
the middleware itself and does **not** implement Stage 2D route protection —
Stage 2D still owns deciding how the coming-soon experience is served/gated.

## Assets Scott must supply

- `public/images/coming-soon/hero-placeholder.webp` — approved, royalty-free,
  collector/card-related hero image (optional; a branded fallback renders
  without it).
- Brand logos are already supplied (`public/brand/holotrailtcg-*.png`) and wired
  into `BrandLogo`.

## Tests

`apps/storefront` now runs Vitest (`pnpm --filter @dtc/storefront test`):

- `lib/newsletter/validation.test.ts` — validation helpers (first-name and
  email rules, including the email max-length boundary).
- `lib/newsletter/dev-adapter.test.ts` — the placeholder adapter fails closed in
  production (no fake success) and only succeeds in development.
- `lib/consent/store.test.ts` — consent-state helpers, including strict
  validation of corrupt/wrongly-typed stored values (analytics never fails open).
- `content/content.test.ts` — coming-soon copy and social configuration.
- `middleware.test.ts` — route-aware tests against the real middleware:
  `/coming-soon` and `/privacy` redirect to their country-aware routes,
  `/{country}/coming-soon` and `/{country}/privacy` pass through, and a genuinely
  missing country-prefixed path is passed through to a 404 render.

Component/DOM render tests are out of scope for this stage (no jsdom/RTL added);
the cookie-dialog focus-restore behaviour is therefore covered by manual/HTTP
verification rather than a unit test.
