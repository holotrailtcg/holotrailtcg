# TCGdex enrichment persistence and review

Stage 4A.3 stores the Stage 4A.2 normalized `CardEnrichmentData` snapshot in a
dedicated proposal table. The raw provider response never crosses the matching
boundary or enters the database. Non-matched outcomes use a separate,
fingerprint-deduplicated attempt table and retain only schema-validated,
bounded diagnostic data (including the safe provider error code).

Matched proposals have one of `PENDING`, `APPROVED`, `REJECTED`, `APPLIED`, or
`SUPERSEDED`. Only pending proposals can be approved or rejected; only approved
proposals can be applied. Repeating the terminal operation is idempotent.
Rows are locked during recording and review transitions. A repeated normalized
snapshot returns the existing row. A changed snapshot supersedes a pending
proposal. An approved proposal causes a conflict and is never silently
superseded. Snapshot fingerprints use recursively key-sorted canonical JSON;
arrays retain their semantic order. Database uniqueness on the
card/provider/snapshot fingerprint and deduplicated diagnostic fingerprint
protects concurrent workers; expected diagnostic unique races return the
existing row.

Application reparses the stored snapshot and uses an explicit allowlist. In
the current Stage 3 model that allowlist is card name/search name and mapped
rarity. Illustrator, artwork, Pokémon metadata, variants, and unmapped rarity
remain diagnostic snapshot data because no corresponding Stage 3 descriptive
columns exist or the rarity is not mapped. Condition, language, finish,
treatment, SKU, stock, costs, prices, price locks, photographs, publication
state, and manual references are not touched.

Application, automatic references, proposal status and application audit are
one transaction. Reference conflicts or audit failures roll back the complete
application. Trusted manual TCGdex card and set references reuse external references, with
`TRUSTED_MANUAL` provenance. Automatic references are written after successful
application and cannot replace a trusted manual reference. Reference writes and
their manual-reference audits are transactionally atomic, provider-identifier
locked and idempotent. Generic proposal/attempt CRUD mutation methods are
blocked; all writes use explicit domain operations. Audit entries use the existing
append-only system and contain bounded IDs, statuses, provider identifiers and
changed field names only; snapshots and provider payloads are excluded.

Runtime schemas bound actors, provider identifiers, diagnostic values and mapped
rarity values. Database checks enforce diagnostic error-code shape and external
reference ownership; variant-to-card ownership is additionally validated by the
transactional service because it spans two rows. Focused module integration,
concurrency, protected-field, audit-safety and migration up/down/reapply tests
cover these guarantees.

## Test infrastructure

The trading-card module integration specs are split across several files
(`trading-cards-module.spec.ts` for Stage 3, `tcgdex-enrichment-persistence.integration.spec.ts`
and `tcgdex-enrichment-migration.integration.spec.ts` for Stage 4A.3). Two of
these — the Stage 3 module spec and the Stage 4A.3 persistence spec — each
bootstrap a real `MedusaApp` for `TRADING_CARDS_MODULE` in their own
`beforeAll`. `@medusajs/modules-sdk`'s `MedusaModule` keeps a process-wide
loader registry per named custom module, and that registry is not safely
re-enterable for the same module name a second time in one process: running
both specs in the same Jest worker previously crashed with `Method
Map.prototype.set called on incompatible receiver #<Map>`, regardless of file
order and regardless of clearing `MedusaModule`'s own instance registry
between them (the corruption sits below that registry). A plain shared
in-memory fixture cannot fix this either — Jest gives every spec *file* its
own global object, so state set by one file's `beforeAll` is never visible to
another file's `beforeAll` in the same run.

The fix keeps both files exactly as they are (each still bootstraps its own
`MedusaApp` independently, so either file remains runnable alone) and instead
guarantees the two `MedusaApp`-bootstrapping files never share an OS process.
`test:integration:modules` (see `apps/backend/package.json`) now runs as two
chained `jest` invocations under one command: the first runs every other
module spec sequentially in one process exactly as before (`--runInBand`), so
count-based assertions (the Stage 4A.3 migration spec's row counts across
`up`/`down`) are never at risk of racing a parallel worker's inserts; the
second targets only the two `MedusaApp`-bootstrapping specs with
`--maxWorkers=2` (no `--runInBand`), which deterministically schedules them
onto two separate worker processes. `apps/backend/jest.config.js` documents
this in code as `MODULE_TESTS_EXCLUDE_MEDUSA_APP_PAIR`. The complete
`pnpm --filter @dtc/backend test:integration:modules` command is the required
verification path for this module — it must be run (and must pass) as one
command, and is what CI and reviewers should run, not the individual spec
files in isolation.

## Rarity normalisation

`trading_card.rarity_comparison` always uses the shared Stage 3
`rarityComparisonForm` helper (`rarity/normalise-rarity.ts`: Unicode NFC
normalisation plus trim, deliberately no case-folding). Stage 3 card creation
(`workflows/trading-cards/create-trading-card-for-product.ts`) and Stage 4A.3
enrichment application (`applyApprovedEnrichmentProposal`) both call this same
helper on the mapped rarity's raw provider value, so the same raw rarity text
written through either path produces byte-identical `rarity_comparison`
values. Neither path invents its own normalisation. `rarity_raw` itself is
stored as the (schema-trimmed) provider value; only `rarity_comparison` is
additionally NFC-normalised.

## Migration rollback

Rolling back Stage 4A.3's migration (`Migration20260714150000` `down`)
intentionally removes only Stage 4A.3-specific data, not Stage 3 data:

- All `trading_card_audit_entry` rows whose `entity_type` is
  `ENRICHMENT_PROPOSAL`, or whose `action` is one of the six Stage 4A.3
  enrichment/manual-reference actions (`TCGDEX_ENRICHMENT_RECORDED`,
  `_SUPERSEDED`, `_APPROVED`, `_REJECTED`, `_APPLIED`,
  `TCGDEX_MANUAL_REFERENCE_RECORDED`). Stage 3 audit rows (identity, condition,
  finish, treatment, price-lock, and non-Stage-4A.3 external-reference audit
  entries) are untouched.
- `trading_card_external_reference` rows that are **set-owned**
  (`card_set_id is not null`), because the restored, narrower Stage 3
  `trading_card_external_reference_card_set_id_foreign`-free constraint set
  cannot represent them. Every Stage 3, card-owned external reference survives
  unchanged.
- The `trading_card_tcgdex_enrichment_proposal` and
  `trading_card_tcgdex_enrichment_attempt` tables themselves, dropped in full.

Down does not delete any `trading_card`, `trading_card_variant`, or
card-owned `trading_card_external_reference` row, and does not touch any
Stage 3 audit action. Repeated `down` (`down`/`down`) is untested and is not
currently a supported operation; only the `up`/`up`/`down`/`up` sequence is
verified.

## Manual-reference limitation

`upsertExternalReferenceInTransaction` currently has no path from an existing
`AUTOMATIC` external reference to `TRUSTED_MANUAL` for the same owner and
identifier: calling `recordTrustedTcgdexCardReference` or
`recordTrustedTcgdexSetReference` over an existing automatic reference on the
*same* card/set returns a stable conflict (`"already exists with different
data"`) rather than promoting it, because provenance is one of the fields the
idempotency comparison treats as significant. This is a real, currently
unimplemented gap, not a silent behaviour change: no reference's owner or
identifier is ever altered, and no incorrect promotion can occur — a reviewer
who wants to mark an existing automatic match as trusted currently has no
supported operation to do so. Implementing an atomic `AUTOMATIC` →
`TRUSTED_MANUAL` promotion (with its own idempotent, concurrency-safe manual
reference audit event) is deferred to Stage 4A.4, alongside the Admin review
UI that would be the first real caller of it — building it now, ahead of any
caller, would broaden this fix beyond persistence hardening.

Admin review routes and UI are deferred to Stage 4A.4.
