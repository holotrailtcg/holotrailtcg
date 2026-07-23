# ADR 0018: Draft product creation at Step 2, publication at Medusa sync

## Status

Accepted for Stage 5B.2 / E2B follow-up (import identity/review correction branch).

## Context

Step 2 ("Match with TCGdex", `create-card-from-inventory-row.ts`) creates a
real Medusa `Product`, `ProductVariant`, `InventoryItem`, and a zero-quantity
`InventoryLevel` for a brand-new card the moment a reviewer confirms its
identity — well before Step 4 (Publish/Apply) ever runs. A branch review
raised this as a concern: "premature Medusa entity creation," since a Medusa
`Product` now exists for a card that may still be rejected, re-matched, or
abandoned during review.

The alternative considered (and rejected) was deferring all Medusa entity
creation to Step 4, so nothing exists in Medusa until a proposal is actually
applied. That would require Step 2/3 (illustrator confirmation, image
upload) to operate against a purely local `TradingCard`/`TradingCardVariant`
representation with no Medusa counterpart yet, and would need Step 4 to
create the product, variant, inventory item, and level all in the same
moment it also assigns a category and publishes — collapsing several
independent, already-tested failure modes into one larger transaction.

## Decision

Medusa entity creation and Medusa product **publication** are deliberately
different moments:

- **Entity creation (Step 2, `create-card-from-inventory-row.ts`)**: the
  `Product` is created as `status: "draft"`, with its `ProductVariant`,
  `InventoryItem`, and a zero-quantity `InventoryLevel`. Draft products are
  not customer-visible and carry no real stock — creating them early lets
  Steps 2–3 (illustrator confirmation, real photograph upload) operate
  against a real, linked Medusa product without any customer-facing
  consequence of doing so.
- **Publication (Step 4, `syncInventoryProposalToMedusa`)**: the product is
  flipped to `status: "published"` only once a `NEW_HOLDING` proposal is
  actually applied with real, positive stock — the point at which a card is
  genuinely ready to sell. This is idempotent (a no-op on an
  already-published product, so every later `QUANTITY_CHANGE` sync leaves
  publication untouched) and is the *last* step in `syncInventoryProposalToMedusa`,
  after category assignment and the real stock write have both already
  succeeded (see the ordering note below).

A draft product that is later rejected or abandoned during review is
accepted as an intentional trade-off: it remains an unpublished, harmless
draft in Medusa rather than never having been created. This is consistent
with how Step 2 already links the product for illustrator/image work before
any commercial commitment exists.

### Side-effect ordering inside `syncInventoryProposalToMedusa`

A branch review found that publication was happening *before* category
assignment and the real stock write, so a category-assignment failure could
leave a product published with a missing category and (on a fresh product)
zero stock. The function now runs, in order:

1. Category assignment (`NEW_HOLDING` only, once, never re-touching an
   already-categorised product) — a failure here returns `FAILED` before
   anything else has changed.
2. The real (positive) stock write — creates or updates the `InventoryLevel`.
3. Product publication (`NEW_HOLDING` only, idempotent) — the last step,
   reached only once category assignment and the stock write have both
   already succeeded.

A `NEW_HOLDING` sync whose product variant has no linked Medusa product at
all now fails clearly with `NO_LINKED_MEDUSA_PRODUCT` rather than silently
returning `SYNCED` without publishing anything.

## Consequences

- A reviewer can browse Medusa Admin and see draft, uncategorised,
  unpublished products for cards still mid-review — this is expected, not a
  data-integrity bug.
- `syncInventoryProposalToMedusa`'s failure categories
  (`CATEGORY_ASSIGNMENT_FAILED`, `NO_LINKED_MEDUSA_CATEGORY`,
  `PRODUCT_PUBLISH_FAILED`, `NO_LINKED_MEDUSA_PRODUCT`) are ordered the same
  way the function itself is: a category failure can never occur after
  publication.
- Dedicated integration tests assert the full lifecycle: draft before sync,
  published after a successful `NEW_HOLDING` sync, never published for
  `QUANTITY_CHANGE`, idempotent on retry, and — critically — still draft
  (never published) when category assignment fails.
