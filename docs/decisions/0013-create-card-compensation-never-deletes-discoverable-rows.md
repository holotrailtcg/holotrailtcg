# ADR 0013: `createCardFromInventoryRowWorkflow` never deletes a committed catalogue row — preserved-and-repairable chains instead

## Status

Accepted for Stage 5B.3 (Codex remediation, third pass).

## Context

ADR 0012 defined `createCardFromInventoryRowWorkflow`'s job: resolve or create
the CardSet → TradingCard → TradingCardVariant → Product → ProductVariant →
InventoryItem chain for one proposal, converging concurrent requests for the
same card onto exactly one chain.

Two earlier remediation passes narrowed, but did not close, the same class of
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
- **A missing InventoryItem on an otherwise-linked ProductVariant** is
  repaired by creating and linking a new one; the InventoryItem itself
  carries no queryable identity a later attempt could use to find an earlier
  partial one, so — like the Product case above — a from-scratch retry
  cannot rediscover an exact prior attempt's item, only create a fresh one.

`CatalogueIntegrityError` is reserved for state this repair logic cannot
safely reconcile on its own: a ProductVariant that legitimately belongs to a
different Product than its TradingCard (`assertVariantProductHierarchy`), or
a Product missing the "Card Variant" option entirely
(`addCardVariantOptionValue`). An ordinary missing link is no longer one of
these cases — it is repaired, not fatal.

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
