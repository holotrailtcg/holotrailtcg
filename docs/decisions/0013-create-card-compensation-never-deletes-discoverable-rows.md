# ADR 0013: `createCardFromInventoryRowWorkflow` never deletes a committed catalogue row — preserved-and-repairable chains, with a real lock around InventoryItem repair

## Status

Accepted for Stage 5B.3 (Codex remediation, fourth pass).

## Context

ADR 0012 defined `createCardFromInventoryRowWorkflow`'s job: resolve or create
the CardSet → TradingCard → TradingCardVariant → Product → ProductVariant →
InventoryItem chain for one proposal, converging concurrent requests for the
same card onto exactly one chain.

Three earlier remediation passes narrowed, but did not close, the same class of
defect:

1. **First pass** gave the three creation steps compensation callbacks that
   deleted whatever they had created, guarded by a same-module
   "would this orphan anything?" check (`delete ... where not exists (...)`)
   and, for the cross-module TradingCardVariant case, a bounded delay before a
   `listInventoryProposals` reference check.
2. **Second pass**, after Codex correctly rejected the delay as merely
   narrowing a TOCTOU window rather than closing it, removed the compensation
   callbacks entirely — but left the same delete calls inside each step's own
   same-invocation `catch` block. A later Codex re-review confirmed this was
   the *same* defect, not a different one: a TradingCard/TradingCardVariant
   committed inside a step's own `try` block is exactly as discoverable, by
   the very same identity lookup every step performs, as anything a
   cross-step compensation callback could reach. Whether the delete lived in
   a `compensate` function or an inline `catch` was never the thing that made
   it safe or unsafe.
3. **Third pass** removed those inline deletes too, replacing them with the
   preserved-and-repairable design this ADR describes below. It left one gap
   Codex's next re-review found: InventoryItem repair (`readVariantChainState`'s
   `inventory_items?.[0]?.inventory_item_id`) picked the *first* linked
   InventoryItem without any lock or count check. Medusa's `product_variant`
   ↔ `inventory_item` link is `isList: true` on both sides (it supports
   inventory kits), so two concurrent repairers for the same ProductVariant
   could both observe zero links and both create and link their own
   InventoryItem — the exact kind of duplicate this ADR otherwise prevents at
   every other layer, and an unsafe `[0]` selection if a duplicate ever did
   exist. **Fourth pass** (this revision) closes that gap with a real,
   database-backed lock — see "PostgreSQL-locked InventoryItem repair" below.

## Decision

**The governing invariant, now applied without exception anywhere in this
file:** once a CardSet, TradingCard, TradingCardVariant, Product,
ProductVariant or InventoryItem has been committed, this workflow never
synchronously deletes it. No compensation callback, no same-step `catch`
block, no helper function anywhere in
`src/workflows/trading-cards/create-card-from-inventory-row.ts` deletes a row
it or an earlier step already committed.

This is only viable because every step's job was reframed as two separable,
idempotent questions:

1. **Does the identity exist?** (CardSet, TradingCard, TradingCardVariant.)
   If not, create it — its own database unique constraint
   (`IDX_trading_card_identity`, `IDX_trading_card_variant_identity`) is what
   breaks a concurrent creation race, exactly as before. The identity row is
   created *first*, ahead of any Medusa-side chain work, so the race is
   always resolved before anything else happens.
2. **Is that identity's Medusa-side chain complete?** (Product/ProductVariant/
   InventoryItem plus the module links connecting them.) If not — whether
   because this is a brand-new identity or because a previous attempt
   committed the identity but died before finishing its chain —
   `ensureProductChainForTradingCard` (step 2) or `ensureVariantProductChain`
   (step 3) creates or restores only the missing part, then links it. Both
   always re-read the actual committed state before deciding anything is
   missing, and resolve an *ambiguous* outcome (a link call threw, but may
   have committed anyway, or a concurrent repairer may have finished first)
   by trusting that re-read over the thrown error — never by retrying a
   blind delete-then-recreate. The 1:1 module links this file creates
   (`trading_card` ↔ `product`, `trading_card_variant` ↔ `product_variant`)
   reject a second link for an identity that already has one, which is what
   makes "attempt the link, and on failure re-read who actually won"
   race-safe without a cross-step transaction — the same pattern already
   used for the identity rows themselves. `ensureProductVariantForDimensions`
   applies the identical pattern one level down: Medusa itself allows at
   most one ProductVariant per distinct option-value combination on a
   product, so a losing "create" race is resolved by re-reading and reusing
   the winner's variant, never by deleting anything.

   > **Correction (ADR 0017):** this "Medusa itself enforces" claim is false
   > once a product has more than one option — confirmed by a real
   > integration-test failure when Condition/Finish/Special Treatment became
   > three separate options instead of one combined `"Card Variant"` option.
   > Two concurrent `createProductVariants` calls for the identical
   > multi-option combination can both succeed, neither throwing. The
   > "attempt the insert, catch and re-read" race-recovery pattern described
   > here no longer applies to `ensureProductVariantForDimensions` — it now
   > holds a PostgreSQL advisory lock (via the Locking Module, the same
   > mechanism `ensureSingleInventoryItemForProductVariant` already used) for
   > its whole check-then-act sequence instead. See ADR 0017 for the full
   > story.

### What repair actually recovers

- **A ProductVariant unlinked from its TradingCardVariant** (whether by a
  workflow failure between creating the ProductVariant and linking it, or by
  an out-of-band `link.dismiss`) is *fully restorable*: `ensureProductVariant
  ForDimensions` looks the variant up by its own deterministic option-value
  combination, so if it still exists on the product, that exact row is
  relinked — never a duplicate.
- **A Product unlinked from its TradingCard** is *not* restorable to the
  exact same row: a bare Product has no deterministic, forward-derivable
  identity the way a ProductVariant's option-value combination does, so
  repair here means creating a fresh Product and linking it. The original,
  now-permanently-unlinked Product is left behind — never deleted, but also
  never rediscovered. This is a known, accepted asymmetry between the two
  repair functions, not an oversight.
- **A ProductVariant with no linked InventoryItem** is repaired by creating
  and linking a new one, and **a ProductVariant with exactly one linked
  InventoryItem** has only its stock level repaired if that's what's
  missing — both under the lock described below. An InventoryItem that a
  failed attempt created but never linked carries no queryable identity a
  later attempt could use to find it, so — like the Product case above — a
  from-scratch retry cannot rediscover that exact prior attempt's item, only
  create a fresh one (or, once locked, correctly find nothing and create
  exactly one).

`CatalogueIntegrityError` is reserved for state this repair logic cannot
safely reconcile on its own: a ProductVariant that legitimately belongs to a
different Product than its TradingCard (`assertVariantProductHierarchy`), a
Product missing the "Card Variant" option entirely
(`addCardVariantOptionValue`), or a ProductVariant with more than one linked
InventoryItem (see below). An ordinary missing link is no longer one of
these cases — it is repaired, not fatal.

## PostgreSQL-locked InventoryItem repair

### Why a real lock is required

`ensureSingleInventoryItemForProductVariant` is the single path every step
goes through to get "the one InventoryItem" for a ProductVariant. Without a
lock, two concurrent repairers for the *same* ProductVariant (e.g. two
different Pulse rows both resolving, at the same time, to an existing card
variant whose InventoryItem step never finished) could both read "zero
linked InventoryItems" before either commits, and both create and link their
own — producing exactly the duplicate this whole ADR exists to prevent.

A process-local mutex cannot close this window: it only protects against
concurrency *within one Node process*. Two different application instances,
or two worker processes on one instance, sharing the same database would
still race each other. Only a lock the database itself arbitrates —
visible to, and enforced across, every process talking to that database —
actually serializes this. Medusa's Locking Module ships a default in-memory
provider for exactly this reason it must never be the one protecting this
path: its own documentation states it "is only intended for use in a
single-instance environment." The official PostgreSQL provider
(`@medusajs/medusa/locking-postgres`) is registered instead, and made the
sole, default provider, so there is no in-memory fallback available even by
omission.

### The lock key and protected critical section

The lock key is `` `trading-card-inventory-repair:${productVariantId}` ``
— scoped to one ProductVariant, so unrelated repairs never contend with each
other. The entire read-decide-create/repair-link sequence runs inside the
lock, acquired via the Locking Module's own `execute(key, job)`:

1. Re-read the ProductVariant's currently linked InventoryItems (a full list,
   never `inventory_items[0]` — see below).
2. Decide: zero links → create and link a new InventoryItem; exactly one
   link → reuse it, repairing only its stock level if that's missing; more
   than one link → throw `CatalogueIntegrityError` (see below).
3. On an ambiguous outcome (the create-or-link call throws, but may have
   actually committed), re-read committed state — still holding the lock —
   before deciding whether to treat it as a success or rethrow.
4. Return the resolved InventoryItem id, still inside the lock, so the
   caller only ever sees a fully-decided result.

The lock is acquired *before* any of this reads or writes anything, and held
across the whole sequence — nothing read before the lock was acquired (e.g.
an earlier, unlocked bounded check elsewhere in this file) is trusted once
it is held; everything is re-read fresh. `execute`'s own implementation
(`PostgresAdvisoryLockProvider`) acquires a real, transaction-scoped
`pg_advisory_xact_lock` and runs the callback inside that same transaction,
releasing — reliably, including when the callback throws — via that
transaction's own commit or rollback, not a hand-rolled `try/finally`.

### Cross-instance behaviour

Because the lock is a real Postgres advisory lock tied to a database
transaction, not an in-process data structure, it serializes callers
regardless of which application instance, worker process, or server they run
on, as long as they share the same database. This is the property this fix
specifically requires and the in-memory default provider cannot offer.

### Why not a unique constraint instead

Medusa's `product_variant` ↔ `inventory_item` link is deliberately `isList:
true` on both sides, supporting inventory kits (one variant genuinely backed
by several items, one item shared by several variants) — a platform-level
feature, not something specific to trading cards. A unique constraint on
that link table would break that feature for every module using it, not
just this one. Holo Trail's own, narrower rule — exactly one InventoryItem
per trading-card ProductVariant — is enforced in application code instead,
by the lock and its count check, not by narrowing a shared platform schema
constraint that isn't Holo Trail's to change.

### The single-InventoryItem invariant, and handling an existing duplicate

Holo Trail's own invariant for these trading-card ProductVariants is exactly
one InventoryItem: zero links means create and link one; exactly one link
means reuse and repair it; more than one link — a state this fixed code path
cannot itself produce, but that could already exist from a legacy import or
a manual repair gone wrong — fails clearly with a `CatalogueIntegrityError`
naming the count, rather than silently picking `inventory_items[0]` and
guessing. Neither existing item is touched or deleted in that case; it needs
a human to determine which one is correct.

### Migration and deployment

`@medusajs/locking-postgres` ships its own bundled migration
(`Migration20241009222919_InitialSetupMigration`), which creates a `locking`
table. It runs through the normal Medusa migration system — `medusa
db:migrate` — the same as any other module's migration, once the Locking
Module is registered in `medusa-config.ts`. It must be applied once in every
environment (dev, test, and eventually production) before this workflow's
concurrent-repair path can run there; see the Stage 5B.3 operations guide for
the exact command and verification steps.

## Deferred: orphan sweep

Rows left behind by a failed, never-retried request, or by a repair that
could not rediscover an exact prior attempt (see above), are not cleaned up
by this change. A safe sweep needs a durable ownership/lease/reference
mechanism — for example, a periodic reconciliation job that only removes a
CardSet/TradingCard/TradingCardVariant/Product/ProductVariant/InventoryItem
once it has had zero referencing rows for a retention window long enough
that no in-flight request could still be about to claim or repair it, rather
than a synchronous check made at the moment one request happens to fail.
This is out of scope for Stage 5B.3 and is not implemented here.

## Consequences

- No code path in this workflow can ever delete a row a concurrent request
  has discovered and is depending on, regardless of timing — because no code
  path in this workflow deletes a committed row at all.
- A failed `createCardFromInventoryRowWorkflow` run is always safely
  retryable: retrying the same proposal finds and repairs whatever chain the
  failed attempt left behind, via the same identity lookups and the repair
  functions above, without duplicating any row.
- A catalogue chain damaged by causes outside this workflow (e.g. a manual
  `link.dismiss`, simulating partial manual repair) is also self-healing on
  the next request for that identity, for exactly the same reason.
- An unreferenced row left by a failed, never-retried request, or by the
  Product/InventoryItem repair asymmetry described above, is a known,
  accepted possibility until the deferred sweep is built.
- Two concurrent repairers for the same ProductVariant's InventoryItem —
  across processes, workers, or instances — are serialized by a real
  database-backed lock, never merely "usually fine in practice": exactly one
  InventoryItem is ever created and linked, and a pre-existing duplicate
  (from outside this workflow) is surfaced clearly rather than guessed at.
