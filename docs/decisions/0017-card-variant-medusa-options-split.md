# ADR 0017: Condition, Finish and Special Treatment are three separate Medusa product options, not one combined "Card Variant" option

## Status

Accepted.

## Context

Since Stage 5B.3, `createCardFromInventoryRowWorkflow` gave every trading-card
Product a single Medusa product option titled `"Card Variant"`, whose value
combined Condition, Finish and (when not `NONE`) Special Treatment into one
string — e.g. `"NEAR MINT · REVERSE HOLO"`. This was never a deliberate
product or storefront design choice; the only rationale on record is the code
comment directly above the combining function: Medusa requires every variant
on a product to have a distinct value for each of the product's shared
options, and combining all three dimensions into one string was the simplest
way to guarantee that.

No ADR documented this design. ADR 0013 (compensation/repair invariants)
inherited it as a given, referencing `"Card Variant"` by name in its
`CatalogueIntegrityError` discussion, but doesn't argue for the single-option
shape itself.

This has a real product-visibility cost: in Medusa Admin and any future
storefront, Condition never appears as its own selectable attribute — only as
a fragment of one opaque combined string. It also isn't necessary: Medusa
natively supports multiple options per product, and only requires each
*variant's full combination of option values* to be unique across a product,
not each option individually. The single combined option was working around
a constraint Medusa doesn't actually impose.

## Decision

Split `"Card Variant"` into three separate Medusa product options:
**Condition**, **Finish**, and **Special Treatment**. Every variant this
workflow creates now carries an explicit value for all three — Special
Treatment's `"None"` is a real value, never an omitted option, since Medusa
requires a value for every option on every variant.

Display labels for all three come from new maps in
`modules/trading-cards/types.ts` — `CARD_CONDITION_LABELS`,
`CARD_FINISH_LABELS`, `SPECIAL_TREATMENT_LABELS` — one Title Case label per
enum value (e.g. `NEAR_MINT → "Near Mint"`, `POKE_BALL_REVERSE → "Poké Ball
Reverse"`). These are the single source of truth for how each value is shown
to a human anywhere in the app, including the Admin eBay category-rules pill
picker, which previously hardcoded its own separate copy of the Finish and
Special Treatment label lists.

**Label source, checked rather than assumed**: neither TCGdex's Card object
(`variants: {normal, holo, reverse, firstEdition}`, no special-treatment
field) nor Pulse's own API (special treatments are folded into the free-text
`material` string) has a ready-made special-treatment vocabulary to source
labels from instead. The existing `SPECIAL_TREATMENT` enum — built from real
observed Pulse `material` strings via `pulse/material-mapping.ts` — remains
the most authoritative source available. TCGdex's finish vocabulary
(`normal`/`holo`/`reverse`/`firstEdition`) doesn't add anything to the
existing `CARD_FINISH` enum either (it has no "Other" catch-all, and
`firstEdition`/`wPromo` are unrelated concepts, out of scope here).

Identity/matching logic changes accordingly:

- `findProductVariantByDimensions` (was `findProductVariantByOptionValue`)
  now matches a variant only when **all three** option values match the
  target combination, not "any option value equals X" — necessary now that
  there's more than one option to check.
- `ensureOptionValue`/`ensureOptionValues` (was `addCardVariantOptionValue`)
  generalizes the same idempotent "add this value to this named option, or
  no-op if it's already there" logic, called once per dimension.
- The `CatalogueIntegrityError` thrown when an expected option is missing
  from a product now names whichever specific option (Condition/Finish/
  Special Treatment) is actually absent, rather than always naming
  `"Card Variant"`.

**A real bug this change surfaced, not merely a refactor risk**: ADR 0013
asserted "Medusa itself enforces at most one variant per distinct
option-value combination on one product," and `ensureProductVariantForDimensions`
relied on that — attempting the insert and treating a thrown error as the
signal that a concurrent caller had won the race. With three separate
options instead of one, the integration test for this exact race
(`"two concurrent requests for a second variant on the same existing card..."`)
started failing: both concurrent `createProductVariants` calls succeeded,
producing two variants with the identical three-value combination, neither
call ever throwing. Medusa's uniqueness guarantee — whatever it actually is
— does not cover this case; the assumption was never safe, it just happened
not to be exercised by the single-option shape's narrower race window.
Fixed by wrapping the whole check-then-act sequence
(`findProductVariantByDimensions` → `ensureOptionValues` →
`createProductVariants`) in a PostgreSQL advisory lock keyed per product,
via the Locking Module — the same pattern `ensureSingleInventoryItemForProductVariant`
already used for the InventoryItem-repair race. This closes the race
outright rather than trying to detect a duplicate after the fact.

No data migration was needed: `trading_card`, `trading_card_variant` and
`product_option` (title = `"Card Variant"`) were all empty at the time of
this change — a clean pre-launch codebase, before Stage 10 (Products,
pricing and promotions) has begun.

## Consequences

- Condition, Finish and Special Treatment each show as their own dropdown in
  Medusa Admin (and later, the storefront), instead of one combined string.
- `ADR 0013`'s "at most one ProductVariant per distinct option-value
  combination on a Product" and its `"Card Variant"`-specific
  `CatalogueIntegrityError` language now apply to the combination of three
  options rather than one — the underlying repair/idempotency invariant is
  unchanged, only which option(s) it's checked against.
- `create-card-from-inventory-row.ts` remains the sole place in the codebase
  that creates or extends a trading card's Medusa Product/ProductVariant
  chain (confirmed by exhaustive search), so this is the only production
  file this change touches.
