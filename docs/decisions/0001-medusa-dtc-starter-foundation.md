# 0001 — Medusa DTC Starter as the Stage 1 foundation

- **Status:** Accepted
- **Date:** 2026-07-13
- **Stage:** 1 (clean Medusa foundation)

## Context

Stage 1 requires a clean, supported ecommerce foundation: a Medusa v2 backend +
Admin, a Next.js storefront, local development against separate development and
test databases, and a working browse → basket → test-checkout flow using
Medusa's manual payment provider. No Holo Trail custom domain logic and none of
the later external integrations are in scope.

## Decisions

### 1. Use the official Medusa DTC Starter

We adopted [`medusajs/dtc-starter`](https://github.com/medusajs/dtc-starter): a
pnpm + Turbo monorepo with `apps/backend` (Medusa v2 + Admin) and
`apps/storefront` (Next.js). Pinned versions from the starter: Medusa **2.17.2**,
`pnpm@10.11.1`, Node `>=20`, Turbo `^2`, ESLint `9`.

**Rejected:** the similarly named `tinloof/medusa-dtc-starter-munchies`, because
it depends on **Sanity** (a hosted CMS). Adding a hosted service requires
approval per `CLAUDE.md`, and it is unnecessary for this stage.

The starter was copied into the (near-empty) repository additively; the existing
`CLAUDE.md`, `.claude/`, `docs/` and git history were preserved. The starter's
own git history was not imported.

### 2. Region and currency: United Kingdom / GBP

Holo Trail is a UK-only store. The seed
(`apps/backend/src/scripts/initial-data-seed.ts`; originally under
`src/migration-scripts/`, relocated in [0002](0002-relocate-seed-out-of-migration-scripts.md))
was changed from the starter's Denmark/EUR defaults to a **United Kingdom** region in **GBP**,
country `gb`, a UK-only shipping zone, and a UK warehouse. Store default currency
is `gbp` (USD retained as a secondary supported currency; EUR removed). Variant
and shipping prices were converted to GBP so that a `gb`/GBP storefront region
can resolve prices and complete checkout. The storefront uses
`NEXT_PUBLIC_DEFAULT_REGION=gb`.

No custom pricing or shipping *rules* were added — this is only the seeded test
data, kept as close to the starter's shape as possible.

### 3. Remote managed database (Neon), separate dev and test

Docker Desktop is unavailable on the development machine (hardware
virtualisation disabled), so local PostgreSQL/Redis containers are not used.
PostgreSQL is provided by **Neon**:

- Development database: `holotrail_medusa_dev`.
- Test database: a **separate** Neon database `holotrail_medusa_test`.

Medusa uses the **direct** (non-pooler) Neon connection string with
`?sslmode=require`, for both runtime and migrations, because Neon's PgBouncer
pooler runs in transaction mode (incompatible with migrations / prepared
statements) and Medusa exposes only a single `DATABASE_URL`. See
[operations/local-development.md](../operations/local-development.md).

### 3a. Environment-file permission rule narrowed

`.claude/settings.json` originally denied `Read(./.env.*)`, which also blocked
editing the non-secret, committed `.env.example` and `*.env.template` files. The
deny rule was narrowed to block only real secret files (`.env`, `.env.local`,
`.env.development`, `.env.production`, `.env.test`, and any `.env.*.local`) while
allowing the committed templates. Real environment files are never read, created
or edited by the assistant.

### 4. Redis is NOT used in Stage 1 (Upstash not wired)

The official starter's `medusa-config.ts` wires **no** Redis modules; it runs on
Medusa's in-memory event bus, cache and workflow engine. The `REDIS_URL` entry
in `apps/backend/.env.template` is therefore currently unused.

Consequently **no Redis / Upstash resource is required for Stage 1**, for
development or for tests. Medusa's Redis modules (`@medusajs/event-bus-redis`,
`@medusajs/cache-redis`, `@medusajs/workflow-engine-redis`) use ioredis and would
require a TLS `rediss://` endpoint plus validation against known issues (e.g.
[medusa#8422](https://github.com/medusajs/medusa/issues/8422), scheduled jobs on
the Redis workflow engine). Because Upstash compatibility with Medusa's
workflow-engine could not be fully confirmed from documentation alone, wiring
Redis is **deferred** and must be validated with a real connection test when a
later stage needs durable workflows / shared infrastructure.

### 5. Test-database safety guard

Added `apps/backend/src/utils/assert-test-database.ts`, wired via
`apps/backend/integration-tests/setup.js` (which also fixes the starter's dangling
`setupFiles` reference). It aborts any test run whose `DATABASE_URL` does not name
a database containing `test`, and requires a database for integration test types.
Unit-tested in `assert-test-database.unit.spec.ts`.

### 6. Tooling fixes required for this environment

- **`cross-env`** was added to `@dtc/backend` devDependencies, and the three
  `test:*` scripts were wrapped with it. The starter's scripts use bash-style
  inline env vars (`TEST_TYPE=unit … jest`) which fail under pnpm's default
  Windows shell.
- **`onlyBuiltDependencies`** was added to `pnpm-workspace.yaml` (pnpm 10 blocks
  dependency build scripts by default) for `@swc/core`, `esbuild`,
  `msgpackr-extract`, `protobufjs`, `sharp`, `unrs-resolver`. Medusa telemetry's
  build script is intentionally left unapproved.

### 7. Removed the starter's Medusa auto-update workflow

Deleted `.github/workflows/update.yaml` (a manual-dispatch `medusajs/medusa-update-action`
that opens PRs and requires an `ANTHROPIC_API_KEY` secret). It is outside Stage 1
(CI is Stage 2) and conflicts with the pinned-version / controlled-change
workflow. A reviewed dependency-update process (e.g. Dependabot + normal PRs) can
be added later.

### 8. Fixed the starter's storefront lint errors

The starter's storefront shipped 10 `next lint` errors. These were fixed minimally
without disabling rules (see `apps/storefront/src/lib/data/cart.ts` and
`.../layout/components/language-select/index.tsx`): unused stub params prefixed
with `_`, `any` replaced with accurate types (`unknown[]`, typed form-data object
+ a single `as unknown as HttpTypes.StoreUpdateCart` cast, `instanceof Error`
narrowing in catch blocks), and two unnecessary `@ts-ignore` directives removed
(TypeScript reported them as unused). All quality gates are green.

## Consequences / known limitations

- Three `react-hooks/exhaustive-deps` **warnings** remain in the storefront
  (`shipping`, `shipping-address`, `product-actions`). They are non-blocking and
  were intentionally left as-is, because "fixing" them (adding effect
  dependencies) would change runtime behaviour. Revisit in Stage 2/3.
- `NEXT_PUBLIC_STRIPE_KEY` exists in the storefront template but is left empty;
  checkout uses the manual provider only.
- Two pre-existing peer-dependency warnings from the starter's dependency tree
  (`@aws-sdk/client-s3`, `vite` vs `@types/node@17`) are left as shipped.
