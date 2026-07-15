# Environment variables

This is the authoritative environment catalogue through Stage 2C. Real values
belong only in git-ignored app-local files or the owning deployment platform.
Committed examples contain blank values or clearly fake test values only.

## Files and ownership

| File or platform | Committed | Owner and purpose |
| --- | --- | --- |
| `.env.example` | Yes | Combined placeholder-only reference; it is not loaded by either app |
| `apps/backend/.env.template` | Yes | Backend development reference |
| `apps/backend/.env` | No | Local backend development configuration and secrets |
| `apps/backend/.env.test.template` | Yes | Backend test reference with fake provider examples only |
| `apps/backend/.env.test` | No | Dedicated test database and local test configuration |
| `apps/storefront/.env.template` | Yes | Browser-safe storefront reference |
| `apps/storefront/.env.local` | No | Local storefront public configuration |
| Vercel Preview / Production | No | Storefront variables only; no backend secret belongs in Vercel |
| Future Medusa host | No | Backend configuration and secrets |

Never put `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `RESEND_API_KEY`,
`RECAPTCHA_SECRET_KEY`, or `NEWSLETTER_RATE_LIMIT_HASH_SECRET` in a storefront
file or any `NEXT_PUBLIC_` variable.

## Stage 2C deployment matrix

`Build` means a production storefront build. Backend newsletter values are not
read by `next build`; they are required on the future Medusa runtime instead.

| Variable | Owner / class | Local file and committed template | Local requirement | Automated tests | Build | Vercel Preview / Production | Future Medusa host |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | Backend / secret | Backend `.env`; backend template | Required to submit | Fake/injected; never real | No | Never | Required |
| `RESEND_FROM_EMAIL` | Backend / config | Backend `.env`; backend template | Required to submit | Fake/injected | No | Never | Required; verified Resend domain |
| `RESEND_REPLY_TO_EMAIL` | Backend / config | Backend `.env`; backend template | Required to submit | Fake/injected | No | Never | Required |
| `RECAPTCHA_SECRET_KEY` | Backend / secret | Backend `.env`; backend template | Required to submit | Fake verifier; never real | No | Never | Required |
| `NEWSLETTER_RECAPTCHA_MIN_SCORE` | Backend / config | Backend `.env`; backend template | Required to submit | Explicit fake config | No | Never | Required |
| `NEWSLETTER_RECAPTCHA_ALLOWED_HOSTNAMES` | Backend / config | Backend `.env`; backend template | Optional, recommended locally as `localhost` | Explicit fake config | No | Never | Recommended; include approved storefront hosts |
| `NEWSLETTER_RECAPTCHA_MAX_TOKEN_AGE_SECONDS` | Backend / config | Backend `.env`; backend template | Optional; default `120` | Explicit fake config | No | Never | Optional |
| `NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES` | Backend / config | Backend `.env`; backend template | Optional; default `60` | Override/config tests | No | Never | Optional |
| `NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS` | Backend / config | Backend `.env`; backend template | Optional; default `300` | Explicit fake config | No | Never | Optional |
| `NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS` | Backend / config | Backend `.env`; backend template | Optional; default `120` | Explicit fake config | No | Never | Optional |
| `PUBLIC_STOREFRONT_URL` | Backend / config | Backend `.env`; backend template | Required to submit | Fake local origin | No | Never | Required; canonical public storefront origin |
| `NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS` | Backend / config | Backend `.env`; backend template | Required to submit | HTTP harness override | No | Never | Required |
| `NEWSLETTER_RATE_LIMIT_MAX_REQUESTS` | Backend / config | Backend `.env`; backend template | Required to submit | HTTP harness override | No | Never | Required |
| `NEWSLETTER_RATE_LIMIT_HASH_SECRET` | Backend / secret | Backend `.env`; backend template | Required to submit | Fake test secret | No | Never | Required |
| `NEWSLETTER_TRUST_PROXY` | Backend / config | Backend `.env`; backend template | Set `false` | HTTP harness sets `true` | No | Never | Required decision; default remains off |
| `NEWSLETTER_TRUSTED_IP_HEADER` | Backend / config | Backend `.env`; backend template | Unset while proxy trust is off | Test-only header | No | Never | Required only when proxy trust is enabled |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | Storefront / public | Storefront `.env.local`; storefront template | Required to exercise submission; unrelated dev pages may render without it | Explicit fake/injected boundary | Yes | Required in both | Never |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | Storefront / public | Storefront `.env.local`; storefront template | Required | Explicit test boundary | Yes | Required in both | Never |
| `NEXT_PUBLIC_BASE_URL` | Storefront / public | Storefront `.env.local`; storefront template | Optional local HTTP origin; defaults to `http://localhost:8000` | Explicit test boundary | Yes | Required; real public HTTPS origin | Never |

`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` is also required by both storefront
development and production builds because all Medusa Store API requests use it.
It is public, but should still be scoped through Medusa sales-channel controls.

## Validation, failure, logging and rotation

| Variable | Safe example | Validation and missing/invalid behavior | Logging rule | Rotation / change rule |
| --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | blank placeholder | Non-empty; lazy resolution throws and subscribe returns generic `503` | Never log | Rotate in Resend on exposure or scheduled secret rotation |
| `RESEND_FROM_EMAIL` | `Holo Trail TCG <hello@example.invalid>` | Bare or friendly address; invalid throws | Address is configuration but is not logged by Stage 2C | Change only with a verified sending domain |
| `RESEND_REPLY_TO_EMAIL` | `support@example.invalid` | Valid bare address; invalid throws | Not logged by Stage 2C | Change with the support mailbox |
| `RECAPTCHA_SECRET_KEY` | blank placeholder | Non-empty; missing/invalid fails closed before Google verification | Never log or expose | Rotate with Google; update backend only |
| `NEWSLETTER_RECAPTCHA_MIN_SCORE` | `0.5` | Number `0`-`1`; invalid throws | May log only as deployment config, not with a token | Change-controlled abuse policy |
| `NEWSLETTER_RECAPTCHA_ALLOWED_HOSTNAMES` | `localhost` | Optional comma-separated hostname-only entries; invalid entry throws | May log approved hostnames, never token/provider body | Update with approved storefront hosts |
| `NEWSLETTER_RECAPTCHA_MAX_TOKEN_AGE_SECONDS` | `120` | Integer `1`-`300`; default `120`; invalid throws | Safe aggregate config only | Change-controlled abuse policy |
| `NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES` | `60` | Integer `1`-`10080`; default `60`; invalid throws when lifecycle runs | Safe aggregate config only | Change-controlled security policy |
| `NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS` | `300` | Integer `0`-`86400`; default `300`; invalid throws | Safe aggregate config only | Change-controlled delivery policy |
| `NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS` | `120` | Integer `1`-`3600`; default `120`; invalid throws | Safe aggregate config only | Keep comfortably above sender timeout |
| `PUBLIC_STOREFRONT_URL` | `http://localhost:8000` | Bare HTTP(S) origin; production requires HTTPS; non-production HTTP is local-only | Origin may be logged, never a generated token URL | Change with canonical storefront origin |
| `NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS` | `60` | Integer `1`-`86400`; missing/invalid makes subscribe fail closed | Aggregate config only | Change-controlled abuse policy |
| `NEWSLETTER_RATE_LIMIT_MAX_REQUESTS` | `5` | Integer `1`-`1000`; missing/invalid makes subscribe fail closed | Aggregate config only | Change-controlled abuse policy |
| `NEWSLETTER_RATE_LIMIT_HASH_SECRET` | blank placeholder | Trimmed string of at least 32 characters; missing/invalid fails closed | Never log | Rotate on exposure; rotation intentionally starts fresh buckets |
| `NEWSLETTER_TRUST_PROXY` | `false` | Only case-insensitive trimmed `true` enables trust; otherwise off | Safe boolean only | Enable only after host trust-boundary review |
| `NEWSLETTER_TRUSTED_IP_HEADER` | blank while disabled | Required when proxy trust is true; one named single-IP header only | Header name may be logged, never its value | Change only with hosting topology |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | blank placeholder | Missing in development leaves pages available but submission fails closed; missing in production stops the build | Public value may be visible; generated tokens must never be logged | Rotate as a pair with the backend secret/key registration |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | `http://localhost:9000` | Required by the adapter/result API and production storefront configuration | Origin is public; token-bearing fetch URLs must not be logged | Change with backend public origin |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:8000` | Bare HTTP(S) origin; trailing slash is normalised away; production rejects missing, malformed, HTTP, localhost and Vercel preview values | Public origin only | Change with the canonical public domain |

All required backend newsletter readers are lazy: the Medusa process can boot
without provider configuration, but `POST /store/newsletter/subscribe` cannot
proceed and returns a fixed generic `503`. Confirmation and unsubscribe do not
need Google or Resend configuration. Storefront production builds deliberately
require the public site key; development rendering does not, and the form has no
simulation or fallback success path.

## Consent version

`NEWSLETTER_CONSENT_TEXT_VERSION` is the source-controlled constant in
`apps/backend/src/api/store/newsletter/shared/consent.ts`, not an environment
variable. The backend controls it and the consent timestamp/source. Increment
the constant whenever the displayed consent meaning changes. Do not add it to
local env files or deployment platforms.

## Test harness variable

`MEDUSA_ADMIN_DISABLE` exists only so the real Medusa HTTP integration harness
can boot without a built Admin UI. The harness supplies it directly; it does not
belong in normal templates, Vercel, or the future Medusa-host configuration.
Admin is disabled only when the value is the exact case-sensitive string
`"true"`; every other value leaves Admin enabled.

## Baseline application variables

### Stage 4A.1 TCGdex client

The backend TCGdex client is server-only and requires no provider credential.
It supports English (`en`), Japanese (`ja`), and Traditional Chinese (`zh-tw`).
`TCGDEX_MAX_RETRIES` means retries after the initial request, so the default of
`3` permits at most four HTTP requests for one client method call. Responses are
validated and bounded before they are returned; this stage does not persist
provider data.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TCGDEX_API_BASE_URL` | `https://api.tcgdex.net` | TCGdex API origin; HTTPS is required except explicitly permitted localhost test use |
| `TCGDEX_REQUEST_TIMEOUT_MS` | `5000` | Per-request timeout |
| `TCGDEX_MAX_RETRIES` | `3` | Retries after the initial request |
| `TCGDEX_RETRY_BASE_DELAY_MS` | `250` | Initial exponential-backoff delay |
| `TCGDEX_RETRY_MAX_DELAY_MS` | `4000` | Maximum retry delay, including bounded `Retry-After` values |
| `TCGDEX_MAX_RESPONSE_BYTES` | `1048576` | Maximum response body size |

The client exposes safe error codes for `NOT_FOUND`, `RATE_LIMITED`,
`SERVER_ERROR`, `INVALID_RESPONSE`, `TIMEOUT`, `NETWORK_ERROR`,
`INVALID_REQUEST`, and `CONFIGURATION_ERROR`. It has no persistence, matching,
enrichment, workflow, or Admin responsibility in Stage 4A.1.

- Backend: `DATABASE_URL`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`,
  `JWT_SECRET`, and `COOKIE_SECRET`. Use a direct test database whose name
  contains `test` for integration tests. `DB_NAME` is documentation-only and is
  not read by current code. Redis is not wired in this stage.
- Storefront: `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_MEDUSA_BACKEND_URL`, `NEXT_PUBLIC_BASE_URL`, and
  `NEXT_PUBLIC_DEFAULT_REGION=gb`. `NEXT_PUBLIC_STRIPE_KEY` remains unused.
- Next.js supplies `NODE_ENV`; do not set it in `.env.local`.

## Stage 2D launch gate

`COMING_SOON_MODE` (Storefront `.env.local`; storefront template) is a
server-only route-gating switch read in `apps/storefront/src/middleware.ts`
via `resolveComingSoonMode` (`src/lib/coming-soon/config.ts`). It is
deliberately not `NEXT_PUBLIC_` — it is only ever read server-side and never
reaches the browser bundle.

| Value | Behaviour |
| --- | --- |
| Exact string `"true"` | Coming-soon mode is enabled: only `/coming-soon`, `/privacy`, `/newsletter/confirm` and `/newsletter/unsubscribe` (each country-prefixed) are reachable; site metadata endpoints `/robots.txt` and `/sitemap.xml` bypass the gate; every other storefront route redirects (307) to the country-aware coming-soon page. |
| Exact string `"false"` | Coming-soon mode is disabled: the full Medusa DTC storefront routes normally. |
| Missing, empty, or any other value (e.g. `"TRUE"`, `"1"`) | Fails closed — treated the same as `"true"`. The unfinished store must never be exposed by an unset or mistyped variable. |

No new dependency, secret, or backend change is introduced by this
variable — see `docs/decisions/0006-stage-2d-route-gating.md` for the full
design rationale (allowlist policy, fail-closed default).

## Test database safety

Before any automated database-backed test or reviewed migration command, load
the effective test `DATABASE_URL`, parse the database name, and invoke
`assertTestDatabase`. It rejects missing URLs and any database name that does
not contain `test`, without printing credentials. Never reset, drop, or reseed a
database merely to verify Stage 2C migrations.
