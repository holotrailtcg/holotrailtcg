# 0002 — Relocate the initial data seed out of migration-scripts

- **Status:** Accepted
- **Date:** 2026-07-13
- **Stage:** 1 (clean Medusa foundation)

## Context

The Stage 1 UK/GBP seed initially lived at
`apps/backend/src/migration-scripts/initial-data-seed.ts`. Medusa's
`medusa db:migrate` **automatically executes any data-migration script in
`src/migration-scripts/`**. During Phase B bring-up this meant `db:migrate`
seeded the store as a side effect of migrating — the seed ran without being
invoked explicitly.

The seed uses `create*Workflow` calls (regions, products, shipping, inventory),
so it is **not idempotent**. Leaving it under `migration-scripts/` means any
future `db:migrate` against an already-seeded database would re-run it and
duplicate data or fail on unique constraints. It also splits seeding across two
entry points (the automatic migration hook and the `seed` npm script), which is
confusing and unsafe.

## Decision

Move the seed to the general script location and make the `seed` npm script the
**single** seeding entry point:

- `apps/backend/src/migration-scripts/initial-data-seed.ts`
  → `apps/backend/src/scripts/initial-data-seed.ts`
- `apps/backend/package.json` → `"seed": "medusa exec ./src/scripts/initial-data-seed.ts"`
- The now-empty `src/migration-scripts/` directory was removed so `db:migrate`
  can no longer execute the seed automatically.

The seed's business behaviour and UK/GBP data are **unchanged** — this is a pure
relocation plus reference updates. The seed was **not** re-run and `db:migrate`
was **not** re-run as part of this change; the data seeded during Phase B stands.

## Consequences

- `medusa db:migrate` now only applies schema/core data migrations; it no longer
  seeds.
- Seeding is done only via `pnpm --filter @dtc/backend seed` (which runs
  `medusa exec ./src/scripts/initial-data-seed.ts`). It remains non-idempotent
  and is intended for a fresh database.
- Documentation references were updated:
  [operations/local-development.md](../operations/local-development.md) and the
  path pointer in [0001](0001-medusa-dtc-starter-foundation.md).
