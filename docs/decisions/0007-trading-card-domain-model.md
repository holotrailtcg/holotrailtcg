# 0007 — Trading-card domain model

- **Status:** Proposed
- **Date:** 2026-07-14
- **Stage:** 3 (trading-card domain foundation)

## Context

Holo Trail needs a domain boundary for Pokémon card identity and commercial
variants before later Pulse, TCGdex, image, pricing, inventory, and eBay work.
Medusa remains the owner of products, product variants, and inventory.

The four supplied UTF-8 Pulse exports were inspected directly. This revision
contains 635 rows, 315 language/set/card-number groups, 354 distinct Product
IDs, and 47 set-code prefixes. No Product ID maps to multiple card/variant
identities and no language/set/card-number group has conflicting names. An
earlier analysis counted 666 rows from a prior export revision; that count is
not a Stage 3 invariant.

## Decision

### Canonical identity and sets

`trading_card_set` stores game, language, display name, provider set code, and
optional Holo Trail key/release date. Stage 3 supports only game `POKEMON` and
languages `EN`, `JA`, and `ZH`. The stable set code is taken from the Product ID
prefix (`me04`, `sv1v_jp`, `cbb2_scn`, etc.), not the display name.

`trading_card` derives game/language through its set. It does not duplicate
those fields. Its active unique identity is `(card_set_id,
card_number_normalised)`. The original number remains verbatim; comparison uses
Unicode NFC plus outer-whitespace trimming and never parses a number.

One canonical card links to one Medusa product. Card names and slugs are
descriptive/search fields, not identity.

The product hierarchy is an invariant of the only variant-link creation
workflow: a Medusa product variant can link to a trading-card variant only
when its owning product is the same product linked to the canonical card. The
workflow resolves both products itself and calls the shared trading-card
service guard before it creates either the domain variant or the remote link.
Callers and Admin presentation are not trusted to enforce this rule. Raw
variant creation alone cannot create a Medusa link and is not a second link
path.

### Commercial variants

`trading_card_variant` represents condition + finish + special treatment and
links one-to-one to a Medusa product variant. Identical copies converge on this
identity; Stage 3 has no quantity field and performs no Medusa inventory work.

Conditions exclude Mint and support Near Mint, Lightly Played, Moderately
Played, Heavily Played, and Damaged. Missing condition defaults to Near Mint
with `DEFAULTED` provenance; explicit values use `EXPLICIT`.

Missing/ambiguous material resolves to unconfirmed `OTHER`, never `NORMAL`.
Explicit non-foil resolves to confirmed `NORMAL`; recognised holo/reverse
values are confirmed. Special treatments use the closed Stage 3 taxonomy;
unknown values become unconfirmed `OTHER` rather than creating enums.

The individual-tracking flag belongs to the commercial variant and is only
stored/read. No price-derived automation exists.

### Rarity and icon taxonomy

The normalised taxonomy is exactly the 14 files under
`apps/storefront/public/rarity-icons`: ace-spec, black-white-rare, common,
double-rare, hyper-rare, illustration-rare, mega-attack-rare, mega-hyper-rare,
no-rarity, promo, shiny-ultra-rare, ultra-rare-single, ultra-rare, and uncommon.

Cards retain verbatim raw rarity plus an NFC/outer-trim comparison value.
Mappings are exact by provider and optional language; language-specific rules
precede provider-global rules. Matching never case-folds, translates, collapses
internal whitespace, or uses fuzzy inference. `NULL` means unmapped;
`NO_RARITY` is an explicit approved mapping.

### SKU

SKU format is
`<GAME>-<LANG>-<SET_CODE>-<CARD_NUMBER>-<CARD_NAME>-<COND><FINISH><TREATMENT>-<HASH>`.
It is uppercase, `[A-Z0-9_-]` only, and at most 128 characters. Readability
segments are truncated first. The final eight uppercase hex characters are
SHA-256 over `tradingCardId|condition|finish|specialTreatment`; database
uniqueness remains final.

### External references, audit, and price lock

Structured references support TCGdex, Pulse, eBay, and Other. Active
`(provider, provider_identifier)` is globally unique; a reference requires a
card and may identify a variant. Duplicate Pulse rows later affect inventory,
not reference count.

Reference upsert takes a transaction-scoped PostgreSQL advisory lock derived
from provider and provider identifier. The lock works across backend processes,
then the transaction reads the active row under `FOR UPDATE`. Equivalent
creates return the same row without another audit. Non-equivalent create calls
receive a domain conflict rather than a unique-index error. An intentional
update must provide both the reference ID and the PostgreSQL `xmin` row version
returned by the previous read; this makes racing non-equivalent updates
optimistic conflicts instead of race-order overwrites. The database unique
index remains the final invariant.

`raw_payload_note` is a diagnostic breadcrumb capped at 500 characters. The
service rejects oversized values without truncation, and
`CK_trading_card_external_reference_note_length` enforces the same maximum in
PostgreSQL. Notes must not contain full payloads or CSV rows, secrets, tokens,
customer information, or other arbitrary content. External-reference audit
snapshots exclude the note entirely and contain only provider, identifier,
card/variant IDs, language, and region. Add/remove snapshots use that bounded
structure; change snapshots include only structural fields that changed.

Explicit service methods write append-only audit rows for identity, commercial
attributes, price locks, and reference lifecycle changes in the same module
transaction. Corrections are new entries. No ORM-wide subscriber records
incidental changes.

Price locking records timestamp, actor, and optional reason. The domain guard
rejects automatic/batch price mutation while leaving future market observation
and suggestion work possible. Stage 3 implements no pricing workflow.
Lock and unlock audits use the actual state returned by the persisted mutation
and contain exactly `price_locked`, `price_locked_at`, `price_locked_by`, and
`price_lock_reason`. The top-level audit actor, source, and reason remain the
mutation context. Repeating an already-satisfied lock or unlock is an idempotent
no-op and creates no duplicate audit. Mutation and audit share one transaction,
so either both persist or both roll back.

### Medusa links and database enforcement

Both link definitions explicitly use `isList: false`. Medusa 2.17.2 checks this
at its link service boundary, but generated SQL did not create per-side unique
constraints. Link sync generated:

- `product_product_tradingcards_trading_card`, columns `product_id` and
  `trading_card_id`;
- `product_product_variant_tradingcards_trading_card_variant`, columns
  `product_variant_id` and `trading_card_variant_id`.

Each generated pivot has a composite primary key and non-unique active-row
indexes. Additive `Migration20260714064500` therefore adds filtered unique
indexes on each of the four foreign-key columns. This makes one-to-one
concurrency-safe at the database boundary as well as producing clear Medusa
service errors.

On a fresh database, link sync must run before module migration so these
generated pivot tables exist:

1. `medusa db:sync-links --execute-safe`
2. `medusa db:migrate --execute-safe-links --all-or-nothing`

No generated migration body was edited.

### Admin proof and fixture strategy

Authenticated `GET /admin/trading-cards/by-product/:id` returns a stable null
result when unlinked or the linked set/card/variant view. A read-only Medusa UI
widget renders that view on product details. Editing and the inventory workspace
remain deferred.

Fixtures use compact, attributed field excerpts verified in the supplied
exports for English/Japanese/Chinese, holo/reverse/treatments, `0104/15`,
missing material, `|lp`, promo data, duplicates, `—`, and `Unknown`. Mojibake
and high-value cases are explicitly structural. No CSV is imported.

## Migrations and verification

- `Migration20260714062433` is CLI-generated and creates the six domain tables,
  relationships, enum checks, active unique indexes, SKU checks, lock
  consistency, confirmed Normal enforcement, and mapped rarity pairing.
- `Migration20260714064206` is CLI-generated and adds raw/comparison rarity
  pairing.
- `Migration20260714064500` is the narrowly scoped hand-written follow-up for
  link one-to-one indexes, justified by inspected Medusa 2.17.2 SQL.
- `Migration20260714120000` is an additive migration for
  `CK_trading_card_external_reference_note_length`. Its up migration queries
  PostgreSQL's catalog for that named constraint on the exact
  `public.trading_card_external_reference` table and adds it only when absent;
  the check remains exactly `length(raw_payload_note) <= 500`. Its down
  migration conditionally removes only that check from that table.

Migrations are applied only to the guarded direct Neon endpoint whose database
is exactly `holotrail_medusa_test`. Host/database are printed without
credentials. Up/down/reapply and final catalog results are recorded in the
Stage 3 implementation report.

The review-fix verification applies the migration in the final up/up/down/down/up
sequence. Focused migration coverage proves conditional add and removal,
reapplication, the catalog definition, rejection of a 501-character note,
acceptance of a 500-character note, and no changes to unrelated constraints,
indexes, or tables. All earlier Stage 3 migrations remain current. The broader
focused tests cover matching and mismatched real product hierarchies, two-way
and five-way reference creation, conflicting creates and optimistic updates,
deterministic audit counts, note boundaries and exclusion markers, complete
lock snapshots, idempotent lock/unlock, and transaction rollback when audit
creation fails.

## Known limitations and exclusions

- Languages and game are intentionally closed for Stage 3 despite older broad
  guidance suggesting future extensibility; adding values requires migration
  and review.
- Medusa ESLint 2.16 misclassifies same-module relative model imports on Windows
  because it compares slash-normalised module roots with backslash-resolved
  imports. Four relationship lines carry narrowly documented rule suppressions;
  Medusa compilation and generated foreign keys verify they are intra-module.
- The configured local `.env.test` uses a Neon pooler host. Migration commands
  derive and verify the corresponding direct host in-process without writing or
  printing credentials.
- Pulse import/pricing, TCGdex calls, R2 uploads, inventory quantity, automatic
  high-value detection, Stripe, storefront presentation, Admin editing, and
  eBay export/publishing are explicitly excluded.
