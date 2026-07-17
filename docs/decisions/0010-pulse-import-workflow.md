# ADR 0010: Pulse import workflow

## Status

Accepted for Stage 5B.1 Slice 2. Extended for Stage 5B.1 Slice 3 (Admin API
and Admin UI) — see the addendum at the end of this document.

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
Admin route, Admin UI, or component test was added in this slice (Slice
2) — those were added in Slice 3 (see the addendum below) but the
out-of-scope list above still applies to both slices unchanged.

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

## Addendum: Stage 5B.1 Slice 3 — Admin API and Admin UI

Slice 3 exposes the Slice 2 workflow and its read-side service methods
through authenticated Medusa Admin routes and builds the "Upload & Import"
step of the Admin workspace. No business logic was added to any route —
every route validates, calls the workflow or an existing read method, and
shapes the response.

- **New source creation happens only inside the upload request.** The
  `POST /admin/trading-card-inventory/imports/upload` route carries either
  `inventorySourceId` (Path A) or the `newSourceDisplayName`/`newSourceProvider`
  pair (Path B) alongside the file, matching `ImportPulseCsvSnapshotInput`'s
  two existing paths exactly. There is no separate pre-create-source Admin
  step in this flow; the general `POST /admin/trading-card-inventory/sources`
  route (Stage 5A.1) is unaffected and still exists for other Admin source
  management.
- **A dedicated retry workflow, not the upload workflow with placeholder
  values.** The `retryOfSnapshotId` branch that already existed inside
  `import-pulse-csv-snapshot.ts` was extracted, unchanged in behaviour, into
  `pulse-import-shared.ts` (shared with the main workflow, which still
  supports its own `retryOfSnapshotId` input for backward compatibility) and
  re-exposed as a new, narrow `retryPulseSnapshotMatchingWorkflow` taking
  `{ snapshotId, actor, source, reason?, previousApprovedSnapshotId? }` — no
  file/filename/mimetype fields. `POST .../snapshots/:id/retry-matching`
  calls only this dedicated workflow.
- **Manual reconciliation is scoped to recoverable states only.**
  `POST .../snapshots/:id/reconcile` calls the existing
  `reconcileInventorySnapshotWorkflow` unchanged; the Admin UI only offers
  the action when a snapshot's summary shows `VALIDATED` (never reconciled,
  or reconciliation didn't complete). Baseline validation is not duplicated
  in the route — `reconcileInventorySnapshot`'s existing service query
  already requires `previousApprovedSnapshotId` (when given) to reference an
  approved, non-rejected/failed snapshot for the same source, and already
  rejects any snapshot that isn't `VALIDATED` (or, idempotently,
  `PENDING_REVIEW` with a matching baseline) before writing anything.
- **Multer is bounded intake and safe error shaping only.** The upload route's
  multipart middleware (`imports/upload-middleware.ts`) uses
  `multer.memoryStorage()` capped at `PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES`
  and maps a Multer error to a clean JSON response — it does not re-validate
  CSV extension, MIME type, or content. `validatePulseFile` inside the
  workflow remains the sole authority for that.
- **A workflow-orchestration boundary bug, found and fixed while wiring the
  first real caller of `.run()` for these workflows.** Neither
  `importPulseCsvSnapshotWorkflow` nor `reconcileInventorySnapshotWorkflow`
  had ever been invoked through their wrapped `.run()` form before this
  slice (every existing test called the underlying plain function directly).
  Doing so for the first time revealed that Medusa's workflow orchestration
  engine clones step input for its transaction context in a way that turns a
  real `Buffer` into its JSON shape (`{ type: "Buffer", data: number[] }`) by
  the time it reaches the step handler, and turns a thrown `MedusaError` into
  a plain object that still carries `MedusaError`'s own `__isMedusaError`
  duck-typing marker but fails `instanceof MedusaError`. Fixed at the two
  points these boundaries are actually crossed: `import-pulse-csv-snapshot.ts`
  now rebuilds a real `Buffer` from `input.fileBuffer` inside the step
  handler before calling the plain function (`reviveFileBuffer`), and
  `trading-card-inventory/shared.ts`'s `safeAdminRead`/`safeAdminWrite` now
  check `MedusaError.isMedusaError(error)` (not only `instanceof`) and
  reconstruct a real `MedusaError` from the surviving `type`/`message`/`code`
  fields before deciding whether to pass it through or wrap it generically.
- **Pulse references have a provider-specific validation contract.** Pulse
  identifiers may contain bounded internal whitespace (for material tokens
  such as "Reverse Holo" or "Poké Ball"), while TCGdex identifiers retain
  their stricter URL-safe schema. Trusted-reference lookup filters explicitly
  to `TRUSTED_MANUAL`; malformed identifiers are not hidden as a lookup miss.
- **Test-database isolation across suite types.** This project uses one
  persistent Neon Postgres database for both the `integration:modules` and
  `integration:http` Jest test types (see `docs/decisions/0001`); there is no
  per-run reset. `migration.integration.spec.ts` (Stage 5A) reapplies its own
  three migrations' original, narrower `trading_card_inventory_audit_entry`
  action CHECK constraint as part of its normal up/down cycle, but doesn't
  own `Migration20260716190000` (the Stage 5B.1 widening that adds the
  `IMPORT_*` actions). Once any suite performs a real Pulse import — which
  Slice 3's own HTTP tests are the first to do outside an isolated module
  spec — real `IMPORT_*` audit rows exist in that shared table, and
  `migration.integration.spec.ts`'s constraint reapplication then fails
  against them regardless of run order. Fixed without weakening any
  constraint or changing application behaviour: inventory module and
  migration suites now run against rollback-only transactions. Expected
  constraint failures use nested savepoints, and each suite restores the
  exact schema and rows it found without truncating sibling-suite data.

## Addendum: confirmed-review retry policy

Matching retry is permitted for `PENDING_REVIEW` only while every affected
proposal is still `PENDING`. The service locks the snapshot and affected
proposals before writing, recomputes affected groups through the existing
Stage 5A.2 engine, updates or removes only those draft proposals, preserves
unaffected proposals, and emits `IMPORT_PROPOSALS_REFRESHED`. Any reviewed or
otherwise actioned affected proposal rejects the whole transaction. Terminal
snapshot states are never retryable. This does not approve/apply proposals or
mutate holdings, Medusa inventory, or product publication; Stage 5B.2 remains
out of scope.
