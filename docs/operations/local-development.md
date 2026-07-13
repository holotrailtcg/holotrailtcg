# Local development runbook (Stage 1)

This runbook sets up the Holo Trail TCG Medusa DTC Starter foundation for local
development against **remote managed databases** (Neon). Docker/WSL are **not**
required or used.

## 1. Prerequisites

- **Node.js v20+** (`node --version`).
- **Corepack + pnpm 10**: run `corepack enable` once. The repo pins
  `pnpm@10.11.1`; Corepack will use it automatically.
- A **Neon** account (managed PostgreSQL).

There is **no Redis requirement in Stage 1** — the starter runs on Medusa's
in-memory event bus, cache and workflow engine. Do not provision Upstash for
this stage (see [decisions/0001-medusa-dtc-starter-foundation.md](../decisions/0001-medusa-dtc-starter-foundation.md)).

## 2. Provision the databases (you do this manually)

Create **two separate** PostgreSQL databases so development and test data can
never mix:

1. **Development**: a Neon database named `holotrail_medusa_dev`.
2. **Tests**: a **separate** Neon database (or a separate Neon project) named
   `holotrail_medusa_test`.

### Which Neon connection string to use

Neon offers two connection strings per database:

- **Direct** — hostname **without** `-pooler`.
- **Pooled** — hostname **with** `-pooler` (PgBouncer, transaction mode).

**Use the direct (non-`-pooler`) connection string for Medusa**, for both the
running backend and migrations. Reasons:

- Neon's pooler runs PgBouncer in *transaction mode*, which does not support the
  persistent session state that schema migrations and prepared statements rely
  on ([Neon: connection pooling](https://neon.com/docs/connect/connection-pooling)).
- Medusa's ORM (MikroORM) uses prepared statements, and Medusa uses a **single**
  `DATABASE_URL` — it has no separate "direct URL for migrations" setting
  ([Medusa discussion #15646](https://github.com/medusajs/medusa/discussions/15646)).
- The Medusa backend is long-running and maintains its own bounded connection
  pool, so it does not need Neon's pooler.

Always append **`?sslmode=require`** to the string, or Medusa fails with
"connection is insecure" ([Medusa issue #9985](https://github.com/medusajs/medusa/issues/9985)).
Keep any additional parameters Neon includes (e.g. `channel_binding`).

If connection limits ever become a concern at scale, revisit pooling then; it is
not needed for local development.

## 3. Create your environment files (you do this manually)

Copy the templates and fill in real values. See the full catalogue in
[environment-variables.md](environment-variables.md).

```bash
cp apps/backend/.env.template apps/backend/.env
cp apps/storefront/.env.template apps/storefront/.env.local
# and create apps/backend/.env.test for the test database
```

Minimum you must set:

- `apps/backend/.env` → `DATABASE_URL` (Neon **dev**, direct + `sslmode=require`),
  `JWT_SECRET`, `COOKIE_SECRET`.
- `apps/backend/.env.test` → `DATABASE_URL` (Neon **test**, name contains `test`).
- `apps/storefront/.env.local` → `NEXT_PUBLIC_DEFAULT_REGION=gb`, and later
  `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` (step 6).

These files are git-ignored. Do not commit them; do not paste their contents
into the assistant.

## 4. Install dependencies

```bash
pnpm install
```

Note: pnpm 10 blocks dependency build scripts by default. The approved native
packages are listed under `onlyBuiltDependencies` in `pnpm-workspace.yaml`, so
they build automatically. If you ever see an "Ignored build scripts" warning
after changing dependencies, run `pnpm rebuild`.

## 5. Run migrations and seed (development database)

> These commands write to the database in `apps/backend/.env` (`DATABASE_URL`).
> Make sure it points at `holotrail_medusa_dev`, **not** the test database.

```bash
# from the repo root
pnpm --filter @dtc/backend exec medusa db:migrate

# create your local admin user (choose your own email/password)
pnpm --filter @dtc/backend exec medusa user -e you@example.com -p supersecret

# seed the store (UK/GBP region, sales channel, shipping, sample products)
pnpm --filter @dtc/backend seed
```

The seed configures a **United Kingdom** region priced in **GBP**, a UK-only
shipping zone, the manual payment provider (`pp_system_default`), and sample
products. See `apps/backend/src/scripts/initial-data-seed.ts`.

## 6. Run the applications

```bash
# terminal 1 — backend + Admin (http://localhost:9000, Admin at /app)
pnpm --filter @dtc/backend dev

# terminal 2 — storefront (http://localhost:8000)
pnpm --filter @dtc/storefront dev
```

After the backend is running:

1. Open Medusa Admin at `http://localhost:9000/app` and log in with the user
   from step 5.
2. Go to **Settings → Publishable API Keys**, copy the key value, and set it as
   `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in `apps/storefront/.env.local`.
3. Restart the storefront so it picks up the key.

## 7. Verify the flow (manual test checkout)

1. Browse the storefront; the seeded product is listed in GBP.
2. Add it to the basket and change the quantity.
3. Check out as a guest: address → shipping → **Test payment** → place order.
4. Confirm the order-confirmation page renders, and that the order appears in
   Medusa Admin under **Orders**.

## 8. Quality commands

| Command | Needs a database? |
| --- | --- |
| `pnpm lint` | no |
| `pnpm --filter @dtc/backend lint` | no |
| `pnpm --filter @dtc/backend test:unit` | no |
| `pnpm --filter @dtc/backend exec tsc --noEmit` | no |
| `pnpm --filter @dtc/storefront exec tsc --noEmit` | no |
| `pnpm --filter @dtc/backend test:integration:http` | **yes — test DB** |
| `pnpm --filter @dtc/backend test:integration:modules` | **yes — test DB** |

## 9. Test-database safety guard

Automated tests load `apps/backend/.env.test` and are protected by a guard
(`apps/backend/src/utils/assert-test-database.ts`, wired via
`apps/backend/integration-tests/setup.js`). It **aborts the test run** unless the
configured `DATABASE_URL` names a database whose name contains `test` (e.g.
`holotrail_medusa_test`). This prevents tests from ever running against the
development or production database. Integration test suites additionally require
a `DATABASE_URL` to be present.

## Ports summary

| Service | URL |
| --- | --- |
| Medusa backend API | `http://localhost:9000` |
| Medusa Admin | `http://localhost:9000/app` |
| Storefront | `http://localhost:8000` |
