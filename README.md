# Holo Trail TCG

Ecommerce platform for Holo Trail TCG, built on the official
[Medusa DTC Starter](https://github.com/medusajs/dtc-starter): a Medusa v2
commerce backend + Admin and a Next.js storefront, managed as a pnpm + Turbo
monorepo.

> **Stage 1 status.** This repository currently contains the clean Medusa DTC
> Starter foundation only. Holo Trail's trading-card domain model, imports,
> pricing, images, payments (Stripe), shipping rules and eBay integrations are
> **not** part of this stage. See `CLAUDE.md` for the full staged plan.

## Repository layout

```
apps/
  backend/     Medusa v2 server + Admin  (package: @dtc/backend)
  storefront/  Next.js storefront        (package: @dtc/storefront)
docs/
  decisions/   Architecture decision records
  operations/  Runbooks (local development, environment variables)
```

## Prerequisites

- **Node.js v20+** (developed against v24; the starter requires `>=20`).
- **pnpm v10** via Corepack (`corepack enable`). The repo pins `pnpm@10.11.1`.
- A **PostgreSQL 15+** database. Stage 1 uses **Neon** (managed Postgres) for
  development and a **separate** Neon database for tests.
- **No Redis is required for Stage 1** — the starter runs on Medusa's in-memory
  event bus, cache and workflow engine. See the decision record for details.

## Getting started

Full instructions — including how to create the Neon databases and where to put
each environment value — are in
[docs/operations/local-development.md](docs/operations/local-development.md).
The environment variables are catalogued in
[docs/operations/environment-variables.md](docs/operations/environment-variables.md).

Quick reference once your environment files exist:

```bash
pnpm install                      # install workspace dependencies
pnpm --filter @dtc/backend dev    # Medusa backend + Admin on http://localhost:9000
pnpm --filter @dtc/storefront dev # storefront on http://localhost:8000
```

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install all workspace dependencies |
| `pnpm lint` | Lint both apps (`turbo lint`) |
| `pnpm --filter @dtc/backend lint` | Lint the backend (`medusa lint`) |
| `pnpm --filter @dtc/backend test:unit` | Backend unit tests |
| `pnpm --filter @dtc/backend exec tsc --noEmit` | Backend typecheck |
| `pnpm --filter @dtc/storefront exec tsc --noEmit` | Storefront typecheck |
| `pnpm --filter @dtc/backend dev` | Run the backend + Admin |
| `pnpm --filter @dtc/storefront dev` | Run the storefront |

Database migrations, seeding and integration tests require live databases and
are documented in the runbook.

## Payments in Stage 1

Checkout uses Medusa's **manual (system) payment provider** (`pp_system_default`)
— the "Test payment" flow in the storefront. Stripe and all other external
integrations are intentionally excluded from this stage.
