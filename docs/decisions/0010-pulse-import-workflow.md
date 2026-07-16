# ADR 0010: Pulse import workflow

## Status

Accepted for Stage 5B.1 Slice 2.

## Context

Stage 5B.1's backend core (commit `04ef033`) delivered pure, side-effect-free
CSV parsing, matching, and persistence primitives on
`TradingCardInventoryModuleService`, but nothing wired them together. There
was no workflow that turned an uploaded Pulse CSV into a validated snapshot
with matched entries and draft reconciliation proposals. This slice adds that
orchestration layer only, reusing the Stage 5A.1 lifecycle, the Stage 5A.2
reconciliation engine, and the Stage 5B.1 parser/matcher without duplicating
any of their logic.

## Decision

- `importPulseCsvSnapshotWorkflow` is a single Medusa workflow step wrapping
  one plain, exported orchestration function
  (`importPulseCsvSnapshot(container, input)`), matching every other workflow
  already in this module. Internally the function proceeds through clearly
  separated phases — resolve source, validate file, create-or-return draft
  snapshot, parse and persist entries, match entries, transition lifecycle,
  reconcile, summarise — each phase either one bounded service transaction or
  a pure in-memory computation. No single database transaction spans more
  than one phase, and no step defines a `compensate` function: every phase is
  either an idempotent create-or-return/create-or-update, or a guarded
  lifecycle transition, so rollback-by-replay is sufficient.
- **Source resolution.** A new `createOrGetInventorySource` service method
  reuses the exact advisory-lock key `createInventorySource` already uses,
  but returns the existing row instead of throwing when the normalized name
  already exists, and refuses (without auto-restoring) an archived source.
  The workflow decides what "reuse vs. create" means; the service method
  stays a narrow persistence primitive usable by other future callers.
- **Duplicate-upload detection is a workflow decision, not a service
  decision.** `findLiveSnapshotByContentHash` is a plain, lock-free read; the
  workflow calls it first and only calls the new `createDraftSnapshot`
  (transactional, advisory-locked on `(source, content_hash)`) when nothing
  is found. `createDraftSnapshot` re-checks under its lock and throws
  `DuplicateSnapshotError` in the rare race-window case, which the workflow
  maps to the same `DUPLICATE` result as a pre-check hit. The unique partial
  index on `(inventory_source_id, content_hash)` remains a defense-in-depth
  backstop; because the lock is acquired before either racer inserts, the
  index is never actually the mechanism that resolves the common case.
- **File intake** is bounded and provider-independent: byte-size limit
  checked before decode, SHA-256 over the raw bytes (never decoded text),
  strict UTF-8 decoding, and filename/MIME allow-lists exported once from
  `pulse/types.ts` (`PULSE_UPLOAD_FILENAME_SUFFIX`,
  `PULSE_UPLOAD_MIME_ALLOWLIST`) alongside the existing `PULSE_FILE_LIMITS`,
  so a future Admin upload route validates against the same constants rather
  than restating them.
- **Lifecycle.** Only `DRAFT → VALIDATED → PENDING_REVIEW` is reachable from
  this workflow, plus `DRAFT → FAILED` when a snapshot has zero usable rows
  (anything not `INVALID`/`SKIPPED`). No new lifecycle states were added —
  every transition uses the existing Stage 5A.1 state machine and its guard.
- **Parsing and persistence.** Row numbers are the CSV's stable 1-based
  physical position, computed once and never recomputed. Persisted entries
  are immutable; a retry never rewrites them, only the separate,
  create-or-update `InventorySnapshotEntryMatch` row.
- **Matching is batched, not per-row.** The pure, already-committed
  `matchSnapshotEntry` contract is unchanged and still runs once per row
  (cheap, in-memory); only the persistence side is batched. A new
  `recordSnapshotEntryMatches` service method bulk-upserts a chunk (~250
  rows) in one transaction via `INSERT ... ON CONFLICT (snapshot_entry_id)`,
  replacing what would otherwise be one transaction per row. The workflow
  supplies the real `TradingCardMatchLookup` implementation via two new
  read-only `trading-cards` methods (`findTrustedExternalReference`,
  `findVariantCandidatesForPulseMatch`); a uniquely-proven case-3 match
  writes a new trusted `ExternalCardReference` by calling the existing
  `upsertExternalReference` directly (no new write method needed — its
  create-or-return-idempotent, provenance-aware behavior already fits).
- **Reconciliation hand-off.** The existing Stage 5A.2
  `reconcileInventorySnapshotWithPriceLocks` is reused unmodified. The
  workflow does not re-implement eligibility checks; it calls this function
  whenever the snapshot reaches `VALIDATED`, trusting the function's own
  guard (requires `VALIDATED`, idempotent on a repeat call with the same
  baseline).
- **A real correctness gap this slice closes:** `reconcileInventorySnapshot`'s
  entry queries had no `outcome` filter at all (Stage 5A.2 predates the
  concept), so a Pulse-parsed `INVALID`/`SKIPPED` row would have silently
  entered a reconciliation group. The query now excludes
  `outcome in ('INVALID', 'SKIPPED')` while treating a `NULL` outcome (the
  older, non-Pulse `addInventorySnapshotEntries` path) as before —
  backward-compatible, verified against the full existing Stage 5A.2 test
  suite.
- **Error taxonomy.** Internally, failures are classified as `RETRYABLE`
  (transient lock/connection contention — replay unchanged), `TERMINAL`
  (malformed bytes, bad headers, oversized file — replay never succeeds),
  `DUPLICATE_SUCCESS` (not an error — maps to the `DUPLICATE` result), or
  `USER_CORRECTABLE` (archived source, zero usable rows — the operator must
  change the target or the file).
- **Result shape.** The `IMPORTED` result is a complete object
  (snapshot id/status, import summary, matching summary, reconciliation
  summary, a bounded warnings list) rather than bare identifiers, so a future
  Admin API will not need several follow-up reads just to render a result.

## Consequences

The workflow creates draft reconciliation proposals only. It never approves,
rejects, or applies a proposal; never mutates a holding; never touches Medusa
`InventoryItem` or `StockLocation`; never creates or publishes a product. No
Admin route, Admin UI, or component test was added in this slice — those are
explicitly deferred to a future Admin API slice.

Two pre-existing defects were found and fixed while wiring this workflow up
against real data, both outside this slice's own new code but load-bearing
for it: `addInventorySnapshotEntriesWithDiagnostics` had an off-by-one in its
batch-insert placeholder list (18 placeholders bound to 19 values per row,
silently shifting every column one position to the right whenever more than
zero rows were inserted); and `providerIdentifierSchema` (shared with TCGdex
external-reference validation) rejected the `/` character, which every real
Pulse `Product ID` contains as part of its card-number segment — widened to
also accept `/` and `|` while still rejecting whitespace, control characters,
`?`, and `#`.
