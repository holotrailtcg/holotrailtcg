# Stage 5B.3 - Create card from inventory row

Stage 5B.3 lets a reviewer resolve an `UNRESOLVED_VARIANT` proposal (a Pulse
row with no matching card) into a real CardSet → TradingCard →
TradingCardVariant → Product → ProductVariant → InventoryItem chain, or
reuse an existing chain safely under concurrent requests. See
[ADR 0012](../decisions/0012-create-card-from-inventory-row-and-card-number-policy.md)
for the full design rationale.

## Endpoint

`POST /admin/trading-cards/create-from-inventory-row`

Body:

```json
{
  "inventoryProposalId": "tciprop_...",
  "cardSetDisplayName": "...",
  "name": "...",
  "cardNumber": "066/196",
  "rarityRaw": null,
  "condition": "NEAR_MINT",
  "finish": "HOLO",
  "specialTreatment": "NONE",
  "finishConfirmed": true,
  "specialTreatmentConfirmed": true
}
```

Set code, source language, and the reviewer identity are all derived
server-side from `inventoryProposalId` — never accepted from the request
body.

- `finishConfirmed`/`specialTreatmentConfirmed` must be the literal boolean
  `true`. `false`, omitted, or any other truthy value (`"true"`, `1`) is
  rejected — this is enforced independently of whatever the Admin UI's
  submit button does.
- `cardNumber` must match the shape `[A-Za-z]*[0-9]+[A-Za-z]?(?:\/[0-9]+)?`
  (optional letter prefix, digits with leading zeros preserved, optional
  single-letter suffix, optional `/denominator`). Malformed input (embedded
  whitespace, multiple slashes, multiple suffix letters, non-numeric
  denominator, empty string) is rejected.
- Every schema failure returns the same generic `400` —
  `{ "message": "The request parameters are invalid." }` — deliberately,
  matching the convention every other admin route in this codebase already
  uses; the response never states which field failed.
- `201` — created. `200` with `idempotentReplay: true` — the proposal was
  already resolved; the same variant is returned, nothing new is created.
  `409` — another request currently holds this proposal's creation claim.

## Card-number identity

`card_number_normalised` (the column the `IDX_trading_card_identity` unique
index and every dedup/matching lookup key off) is denominator-stripped and
uppercase-folded. `card_number` (display) keeps the trimmed, NFC-normalised
input verbatim, including its denominator. `cardNumberForms`
(`src/modules/trading-cards/identity/card-number.ts`) is the single function
every writer goes through; do not write `card_number_normalised` directly
anywhere new.

## Deployment: the normalisation-policy migration

`Migration20260718160000` re-normalises every pre-existing
`card_number_normalised` value to the new (denominator-stripped,
uppercase-folded) shape. It aborts — rather than merging or deleting either
row — if re-normalising would collide two currently-distinct cards in the
same set; an operator must resolve that manually before the migration can
complete. `down()` is not supported (the original denominator/case is not
reconstructible).

Run it the same way as any other Medusa migration: `npx medusa db:migrate`
against the target environment. **There is no deployment pipeline in this
repository yet that runs this automatically** — it must be applied by hand
in every environment (dev, test, and eventually production) that has
existing `trading_card` rows. Until it is applied in a given environment,
Pulse-import matching still works correctly there (see below), so this is
not a hard prerequisite for that environment's correctness — only for
removing the temporary fallback described next.

### Temporary legacy-fallback lookup

`findVariantCandidatesForPulseMatch` matches
`card_number_normalised in (currentForm, legacyForm)` so Pulse-row matching
finds an existing card whether or not `Migration20260718160000` has run
against that row yet. This is intentional, temporary technical debt — remove
the legacy branch (and this note) once every environment that matters is
confirmed migrated and no row anywhere still has a legacy-shaped
`card_number_normalised`.

## Concurrent InventoryItem repair: the PostgreSQL locking fix

`ensureSingleInventoryItemForProductVariant` (in
`create-card-from-inventory-row.ts`) is the single path every step goes
through to get "the one InventoryItem" for a ProductVariant. It runs its
whole read-decide-create/repair-link sequence inside a lock acquired via
Medusa's Locking Module, using the official PostgreSQL advisory-lock
provider (`@medusajs/medusa/locking-postgres`) — see
[ADR 0013](../decisions/0013-create-card-compensation-never-deletes-discoverable-rows.md)
for why this was necessary (Medusa's default in-memory locking provider only
works within a single process) and the full design rationale.

### Infrastructure

- **Dependency**: `@medusajs/locking-postgres` (pinned to the same version as
  `@medusajs/medusa`, 2.17.2) is a direct `package.json` dependency.
- **Registration**: `medusa-config.ts` registers the Locking Module
  (`@medusajs/medusa/locking`) with `@medusajs/medusa/locking-postgres` as its
  sole, default (`is_default: true`) provider.
- **Database**: the provider uses the application's existing `DATABASE_URL`
  connection for its advisory locks — no separate connection string, no new
  environment variable, no Redis.
- **Migration**: the provider ships its own bundled migration
  (`Migration20241009222919_InitialSetupMigration`, part of
  `@medusajs/locking-postgres`), which creates a `locking` table. It runs
  through the normal Medusa migration system —
  `npx medusa db:migrate` (with `NODE_ENV` set to the target environment) —
  the same as any other module's migration. It must be applied once in every
  environment (dev, test, and eventually production) before this workflow's
  concurrent-repair path can run there.
- **Production configuration**: because the PostgreSQL provider is registered
  with `is_default: true` and is the *only* provider in the `providers` array,
  there is no in-memory fallback available to silently take over if the
  provider fails to resolve — Medusa's module loader fails the application's
  own boot if the locking module itself cannot be constructed, rather than
  degrading to the single-instance-only in-memory implementation.

### Why not a unique constraint instead?

Medusa's `product_variant` ↔ `inventory_item` link is deliberately `isList:
true` on both sides, to support inventory kits (one variant genuinely backed
by several inventory items, one item shared by several variants). A unique
constraint on that link table would break that platform-level feature for
every other module, not just trading cards. Holo Trail's own, narrower rule
— exactly one InventoryItem per trading-card ProductVariant — is enforced in
application code instead (`ensureSingleInventoryItemForProductVariant`'s own
count check, backed by the lock), not by widening or narrowing a schema
constraint that isn't ours to change.

### Handling of a pre-existing duplicate

If a ProductVariant is ever found with more than one linked InventoryItem
(e.g. a legacy import or a manual repair gone wrong, not something this
workflow's own fixed code path can produce), the workflow fails clearly with
a `CatalogueIntegrityError` naming the count, rather than guessing which item
is authoritative by picking `inventory_items[0]`. Neither existing item is
touched or deleted; this needs a human to resolve which item is correct.

### Cross-instance behaviour

The advisory lock is scoped to the database, not to a single Node process —
two requests handled by two different application instances (or two worker
processes on the same instance) racing to repair the *same* ProductVariant's
InventoryItem are serialized exactly the same way as two concurrent requests
within one process. This is the property the in-memory default provider
cannot offer, and the reason the fix requires a real database-backed lock
rather than a process-local mutex.

## Explicit exclusions (confirmed out of scope)

A finish/specialTreatment pairing validation rule (e.g. `ENERGY_REVERSE`
must pair with `REVERSE_HOLO`) — no such rule exists anywhere else in the
codebase, and it would risk breaking a legitimate reviewer override where a
human deliberately records a different combination than Pulse suggested.
Automatic conflict resolution for the migration's collision case. A CI/CD
deployment pipeline (none exists yet in this repository).

## Testing

- `create-card-from-inventory-row.integration.spec.ts` — the real workflow
  against real Product/Inventory modules (and, since the locking fix, the
  real `@medusajs/medusa/locking-postgres` provider, never an in-memory
  mock): orphan-safety and cross-proposal concurrency (two concurrent
  unresolved proposals for the same never-seen card converge on one identity
  chain; a second variant on an existing card converges without duplicating
  the product/item); same-step link failures never delete a committed row
  and repair completes a preserved incomplete chain; PostgreSQL-locked
  InventoryItem repair — two concurrent repairers for the same incomplete
  ProductVariant are genuinely serialized by the real advisory lock (a
  deterministic barrier proves both would have raced without it), a thrown
  operation inside the lock releases it (a later retry succeeds), an
  ambiguous link outcome (commits but reports an error) is resolved by
  rereading rather than duplicating, and more than one existing linked
  InventoryItem fails clearly instead of picking `inventory_items[0]`; the
  Stage 5B.2 stock-location policy reused by card creation; and a dedicated
  proof that an existing card migrated from the pre-Phase-8 normalisation
  algorithm is reused, not duplicated, by a fresh request.
- `card-number-normalisation-migration.integration.spec.ts` — the migration
  itself: legacy denominator-inclusive/lowercase-suffix values re-normalised,
  leading zeros preserved, idempotent re-run, collision detected and aborts
  with neither row touched, rows in different card sets normalising
  independently (not a collision).
- `trading-cards-module.spec.ts` — `findVariantCandidatesForPulseMatch`
  against a genuinely unmigrated legacy row (found only via the fallback
  branch) and against an already-migrated row (found via the primary path).
- `create-card-from-inventory-row-schema.unit.spec.ts` — the Zod schema in
  isolation: confirmation literal-`true` enforcement, card-number shape
  acceptance/rejection, strict-schema rejection of unknown fields.
- HTTP integration (`integration-tests/http/newsletter.spec.ts`, the
  `POST /admin/trading-cards/create-from-inventory-row` describe block):
  authentication, creation, idempotent replay, in-progress-claim 409,
  Product reuse across variants, `CatalogueIntegrityError` paths, and the
  full confirmation/card-number rejection matrix, all against a real
  bootstrapped app and database.

## Known limitations

- The legacy-fallback lookup and the manual migration step above are both
  temporary; see ADR 0012 for removal criteria.
- `tcgdex-enrichment-migration.integration.spec.ts` has a known, pre-existing
  failure (a check-constraint violation from shared test-database state)
  unrelated to this stage's work; left unresolved and out of scope here.
- A separate, unrelated read in `syncInventoryProposalToMedusa`
  (`medusa-inventory-sync.ts`, Stage 5B.2) still resolves a ProductVariant's
  InventoryItem via `inventory_items?.[0]`. That workflow only ever
  consumes an already-complete chain this workflow produced (by the time a
  proposal is applied and synced, its variant's InventoryItem already
  exists, uniquely, per the invariant above) rather than creating or
  repairing one, so it was left out of this fix's scope — deliberately, per
  the approved stage boundary — but is worth revisiting if that workflow
  is ever changed to run before this one's InventoryItem guarantee holds.
- The Product/InventoryItem repair asymmetry described in ADR 0013 (a
  Product unlinked from its TradingCard cannot be rediscovered and reused
  the way an unlinked-but-still-present ProductVariant can) still applies;
  the locking fix does not change it.
