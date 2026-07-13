# Environment variables (Stage 1)

This is the authoritative catalogue of every environment variable used in Stage
1, where each value comes from, which application and environment needs it, and
the exact file it belongs in.

> **You enter every real value yourself.** Claude does not create your `.env`
> files or read your secrets. Never paste real secrets into the assistant chat.
> All real env files (`.env`, `.env.local`, `.env.test`) are git-ignored; only
> `.env.example` and `*.env.template` are committed, and they must contain
> placeholders only.

## Files at a glance

| File | Committed? | Purpose |
| --- | --- | --- |
| `apps/backend/.env.template` | yes (placeholders) | Reference for the backend dev env |
| `apps/backend/.env` | **no** (git-ignored) | Your local backend **development** values (Neon dev DB) |
| `apps/backend/.env.test` | **no** (git-ignored) | Your backend **test** values (Neon **test** DB) |
| `apps/storefront/.env.template` | yes (placeholders) | Reference for the storefront env |
| `apps/storefront/.env.local` | **no** (git-ignored) | Your local storefront values |

## Backend — `apps/backend/.env` (development)

| Variable | Source | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Neon (dev DB) | yes | Neon **direct** connection string for `holotrail_medusa_dev`, including `?sslmode=require`. See [local-development.md](local-development.md) for pooled-vs-direct guidance. |
| `DB_NAME` | you | yes | `holotrail_medusa_dev` |
| `JWT_SECRET` | you | yes | Local dev random string. Not a shared/production secret. |
| `COOKIE_SECRET` | you | yes | Local dev random string. |
| `STORE_CORS` | starter default | yes | `http://localhost:8000` |
| `ADMIN_CORS` | starter default | yes | `http://localhost:5173,http://localhost:9000` |
| `AUTH_CORS` | starter default | yes | `http://localhost:5173,http://localhost:9000` |
| `REDIS_URL` | — | **no (unused in Stage 1)** | The starter does **not** wire Redis modules; `medusa-config.ts` ignores this. Leave it unset/commented. See the decision record. |

## Backend — `apps/backend/.env.test` (automated tests)

Loaded automatically by Jest (`jest.config.js` calls `loadEnv("test", …)`).

| Variable | Source | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Neon (**test** DB) | for integration tests | Neon direct connection string for `holotrail_medusa_test`. **The database name must contain `test`** or the test-database safety guard aborts the run (see [local-development.md](local-development.md)). |
| `DB_NAME` | you | optional | `holotrail_medusa_test` |

Unit tests (`pnpm --filter @dtc/backend test:unit`) do **not** need a database.

## Storefront — `apps/storefront/.env.local`

| Variable | Source | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Medusa Admin | yes | The **Medusa publishable API key**, created/copied from Medusa Admin → **Settings → Publishable API Keys** after the backend runs and is seeded. This is a **Medusa** key and is **not** a Stripe key. Do not assume a fixed prefix — copy the exact value the installed Medusa version shows. The storefront refuses to start without it. |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | you | yes | `http://localhost:9000` |
| `NEXT_PUBLIC_DEFAULT_REGION` | you | yes | **`gb`** — Holo Trail is a UK/GBP store. (The upstream template default is `dk`; use `gb` here.) |
| `NEXT_PUBLIC_BASE_URL` | you | yes | `http://localhost:8000` |
| `NEXT_PUBLIC_STRIPE_KEY` | — | **no (leave empty)** | Stripe is out of scope for Stage 1. This is a **Stripe** publishable key, unrelated to the Medusa publishable key above. |
| `MEDUSA_CLOUD_S3_HOSTNAME` / `MEDUSA_CLOUD_S3_PATHNAME` | — | no | Only for Medusa Cloud image hosting; leave empty locally. |
| `NODE_ENV` | you | no | `development` |

## Paste-ready `.env.example` (root)

The committed root `.env.example` should contain the following placeholders
(no secrets). It documents both apps in one place:

```dotenv
# ─── Backend (apps/backend/.env) — development ───────────────────────────────
# Neon DIRECT connection string for the dev database (include ?sslmode=require).
DATABASE_URL=postgres://USER:PASSWORD@HOST/holotrail_medusa_dev?sslmode=require
DB_NAME=holotrail_medusa_dev
JWT_SECRET=replace-with-local-dev-random-string
COOKIE_SECRET=replace-with-local-dev-random-string
STORE_CORS=http://localhost:8000
ADMIN_CORS=http://localhost:5173,http://localhost:9000
AUTH_CORS=http://localhost:5173,http://localhost:9000
# REDIS_URL is NOT used in Stage 1 (Medusa runs in-memory). Leave unset.

# ─── Backend tests (apps/backend/.env.test) ─────────────────────────────────
# Neon DIRECT connection string for the SEPARATE test database.
# The database name MUST contain "test" or the test-db safety guard aborts.
# DATABASE_URL=postgres://USER:PASSWORD@HOST/holotrail_medusa_test?sslmode=require

# ─── Storefront (apps/storefront/.env.local) ────────────────────────────────
# Medusa publishable API key from Admin → Settings → Publishable API Keys.
# This is a MEDUSA key, not a Stripe key.
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_DEFAULT_REGION=gb
NEXT_PUBLIC_BASE_URL=http://localhost:8000
# Stripe is out of scope for Stage 1 — leave empty.
NEXT_PUBLIC_STRIPE_KEY=
```

The committed `.env.example` and the two `*.env.template` files
(`apps/backend/.env.template`, `apps/storefront/.env.template`) are already
populated with placeholder-only values matching the blocks above. The
`.claude/settings.json` deny rule permits editing these committed templates while
still blocking all real secret files (`.env`, `.env.local`, `.env.development`,
`.env.production`, `.env.test`, `*.env.*.local`).
