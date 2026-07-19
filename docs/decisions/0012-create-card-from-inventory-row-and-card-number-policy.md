# ADR 0012: Create-card-from-inventory-row server-side enforcement and the card-number normalisation policy

## Status

Accepted for Stage 5B.3.

## Context

Stage 5B.1/5B.2 leave `UNRESOLVED_VARIANT` proposals — Pulse rows with no
matching TradingCard/TradingCardVariant — sitting in the review queue with no
way to actually create the missing card. Stage 5B.3 adds
`POST /admin/trading-cards/create-from-inventory-row`, backed by
`createCardFromInventoryRowWorkflow`, to resolve or create the
CardSet → TradingCard → TradingCardVariant → Product → ProductVariant →
InventoryItem chain for one proposal and reuse it correctly under concurrent
requests.

Two problems surfaced while hardening this endpoint that this ADR records:
the client-side "reviewer confirmed this" affordance was not enforced by the
server at all, and the card-number identity policy (`card_number_normalised`,
the column the uniqueness index and every dedup lookup depend on) had never
been explicitly defined — it was whatever `trim().normalize("NFC")` happened
to produce.

## Decision

### Server-side confirmation enforcement

`finishConfirmed` and `specialTreatmentConfirmed` in
`createCardFromInventoryRowBodySchema` are `z.literal(true)`, not
`z.boolean()`. A disabled submit button or an unchecked checkbox in the
Admin UI stops nothing against a direct API call; this endpoint exists only
because a human reviewer is confirming a card creation, so an unconfirmed
request (`false`, omitted, or any non-`true` truthy value) is always a bypass
attempt or a client bug, never a legitimate use case. Neither flag is ever
persisted, so there is no stored confirmation state that can go stale —
every request must carry its own fresh `true` or it is rejected with a
generic 400 before the workflow or database is ever touched (see
`parseAdminInput` in `src/api/admin/trading-cards/shared.ts`, which
deliberately collapses every schema failure to the same message rather than
leaking which field failed).

### The card-number policy

`cardNumberForms` (`src/modules/trading-cards/identity/card-number.ts`) is
the single function every card-creation path funnels a card number through:
`CARD_NUMBER_PATTERN = /^[A-Za-z]*[0-9]+[A-Za-z]?(?:\/[0-9]+)?$/` — an
optional letter prefix, a required digit run (leading zeros preserved), an
optional single-letter suffix, an optional `/denominator`. Anything else
(embedded whitespace, multiple slashes, multiple suffix letters, a
non-numeric denominator) is rejected as malformed.

The comparison form (`card_number_normalised`, what the unique index and
every dedup/matching lookup key off) strips the denominator and
uppercase-folds. The denominator is dropped because it carries no identity
information beyond what the card's own `CardSet` already represents (same
set → same total-card count) — without this, the same physical card supplied
with and without its denominator ("044/072" vs "044") would be treated as
two different cards. `original` (the display value, `card_number`) stores
the trimmed, NFC-normalised representation, not the raw input verbatim —
there is no documented audit requirement to retain a reviewer's incidental
surrounding whitespace, so it is not preserved.

The same `CARD_NUMBER_PATTERN` is wired into the Zod body schema, so a
malformed card number is rejected with a clean 400 before any
workflow/database round-trip, in addition to the deeper `cardNumberForms`
check inside the workflow itself.

### Compatibility migration for the algorithm change

Changing the normalisation algorithm mid-branch is a live risk to existing
catalogue rows, not just a forward-looking policy: every row written before
this change stored `card_number_normalised` with its denominator still
attached and original case. `Migration20260718160000` re-normalises every
existing `trading_card` row to the new shape. It **detects collisions before
writing anything**: if re-normalising would make two currently-distinct rows
collide on `(card_set_id, card_number_normalised)`, the entire migration
aborts (`RAISE EXCEPTION`, rolling back the transaction) rather than merging
or deleting either row — an operator must resolve the conflict manually.
`down()` refuses to run; the original denominator and case are not
reconstructible from the migrated value.

Run once against the shared test database via the normal `medusa db:migrate`
path: 756 legacy-shaped rows migrated, 0 collisions.

### Temporary legacy-fallback lookup

`findVariantCandidatesForPulseMatch` (Stage 5B.1's Pulse-matching lookup,
`src/modules/trading-cards/service.ts`) is a **reader** of
`card_number_normalised`, and it was found to disagree with the new writer
algorithm during this hardening pass: a literal `card_number_normalised = ?`
SQL comparison against only the new (denominator-stripped) form returns zero
rows for a row that has not yet been migrated — verified directly against
the real database, not inferred. Relying on "the migration always runs
before new code deploys" was rejected as a fix, because no deployment
pipeline exists in this repository to enforce that ordering. Instead, the
query matches `card_number_normalised in (currentForm, legacyForm)` — both
the new and the pre-Phase-8 (trim+NFC-only) shapes — so matching is correct
regardless of whether `Migration20260718160000` has run in a given
environment.

This is deliberately temporary technical debt, not a permanent
compatibility layer: remove the legacy branch once
`Migration20260718160000` is confirmed applied in every environment that
matters (dev, test, and — once one exists — production) and no
`card_number_normalised` value anywhere still differs from
`normaliseCardNumberComparisonForm(card_number_normalised)`.

## Consequences

- Every reviewer confirmation and every card number is validated server-side,
  independent of any client affordance.
- `card_number_normalised` has one authoritative definition
  (`cardNumberForms` / `normaliseCardNumberComparisonForm` in
  `identity/card-number.ts`), used by every writer and every reader.
- The legacy-fallback branch in `findVariantCandidatesForPulseMatch` must be
  removed once migration coverage is confirmed everywhere — tracked here,
  not enforced by tooling.
- No deployment pipeline exists yet to run `db:migrate` automatically ahead
  of a deploy; this remains a manual step until one is built (out of scope
  for this stage).
