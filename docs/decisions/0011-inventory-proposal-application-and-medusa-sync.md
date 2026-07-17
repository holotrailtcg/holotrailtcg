# ADR 0011: Inventory proposal review, application, and Medusa inventory sync

## Status

Accepted for Stage 5B.2.

## Context

Stage 5A.2 (snapshot reconciliation) and Stage 5B.1 (Pulse CSV import)
produce `InventoryProposal` rows with a fully-defined review-status state
machine (`PENDING → APPROVED|REJECTED → APPLIED`) and a snapshot-status state
machine that includes `APPROVED → APPLYING → APPLIED|FAILED`, but neither
machine was driven by anything: `transitionInventoryProposalStatus` and
`transitionInventorySnapshotStatus` were pure status-flips. Nothing ever
wrote a holding, appended a ledger transaction, or touched Medusa's own
inventory system as a result of a proposal being approved. ADR 0008/0009/0010
explicitly deferred all of "proposal approval, rejection, application, any
holding/ledger/InventoryItem/StockLocation mutation" to this stage.

## Decision

### Two-phase apply: local authoritative write, then best-effort Medusa reflection

`applyInventoryProposal` performs **Phase A** — the atomic, authoritative
local stock movement (holding upsert + ledger append + proposal status flip
to `APPLIED`) — in one transaction, inlining the logic `upsertInventoryHolding`
and `appendInventoryTransaction` each already had (those two methods each
open their own transaction and cannot be composed for atomicity). Only
`NEW_HOLDING` and `QUANTITY_CHANGE` proposals are ever applied; `PRICE_CHANGE`,
`COST_CHANGE`, `NO_CHANGE`, and `UNRESOLVED_VARIANT` are rejected as
out-of-scope without mutation — Holo Trail's public selling price is never
overwritten by a Pulse market price at apply time (see `CLAUDE.md`).

**Phase B** — reflecting the resulting quantity into Medusa — is a *separate*,
best-effort, independently-tracked step. A proposal can be `APPLIED` locally
while Medusa sync is `PENDING` or `FAILED`; this is not a bug, it is the
design. **`review_status = APPLIED` means the authoritative local stock
movement completed. It says nothing about Medusa.** This distinction is
enforced everywhere: the `CK_tci_proposal_applied_consistency` constraint
never requires `medusa_sync_status = SYNCED`; the DTO exposes both fields
independently; the Admin UI badge always shows both facts
(`InventoryProposalStatusBadge`); `computeInventorySnapshotProgress` gates
`fullyComplete` on both being satisfied, separately.

### Idempotency: the proposal id is the canonical identity

Re-calling `applyInventoryProposal` on an already-`APPLIED` proposal is an
idempotent success: it returns the existing `applied_transaction_id`/
`applied_holding_id`/current `medusa_sync_status`, writes
`PROPOSAL_APPLICATION_RETRIED` (never `PROPOSAL_APPLIED` again), and creates
no new ledger row or holding movement. A legacy/internal caller-supplied
`applicationIdempotencyKey` is ignored: the proposal id is always persisted
as the proposal and ledger transaction idempotency key, so callers cannot
select a different identity or collide with another proposal.

Before Phase A begins, `PROPOSAL_APPLICATION_ATTEMPTED` is written durably in
its own small transaction, so "an attempt happened" survives even if Phase A
itself then rejects the call (e.g. a stale baseline) or the process crashes
mid-attempt.

### Baseline protection is per-field, not quantity-only in spirit

Phase A re-reads the holding row `for update` and compares its live quantity
against the proposal's `previous_quantity` (or `0` for `NEW_HOLDING`,
including the case where a holding was created concurrently since
reconciliation — the check never assumes "no holding exists" from
`change_kind` alone). A mismatch is a `STALE_BASELINE` rejection with no
mutation; the mismatch itself is recorded as
`PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE` in its own transaction (not
inside Phase A's rolled-back transaction). Existing `unit_acquisition_cost`/
`unit_market_price`/`unit_selling_price` on the holding are never overwritten
by Phase A, even when present on the proposal row — Stage 5B.2 writes
`quantity` only.

### Medusa sync: real, not feature-flagged, with an attempt-token concurrency guard

`syncInventoryProposalToMedusa` (`workflows/trading-card-inventory/medusa-inventory-sync.ts`)
resolves `TradingCardVariant → ProductVariant` via the existing custom link,
then `ProductVariant → InventoryItem` via Medusa's own default
`product_variant_inventory_item` link, and writes the **absolute resulting
`stocked_quantity`** via `IInventoryService.updateInventoryLevels`/
`createInventoryLevels` — never a relative delta. It is called directly
(`Modules.INVENTORY` resolved from the container), not through a workflow
wrapper, since no compensation is needed.

A real, seeded-`MedusaApp` spike test (not documentation or type inspection
alone) confirmed the exact field shape: `product_variant.inventory_items`
resolves the **link pivot row** (`pvitem_...`), not an `InventoryItemDTO` —
the real inventory item id is the pivot's `inventory_item_id` foreign key,
not its own `id`. The correct query is `product_variant.inventory_items.inventory_item_id`.
The exact key names for manually creating a link also differ by link: the
custom `TradingCardVariant↔ProductVariant` link uses `product_variant_id`,
but Medusa's own default `ProductVariant↔InventoryItem` link uses `variant_id`
— confirmed against official Medusa v2 documentation, since the two are easy
to conflate.

**Stock location** is a single global default (matches the current UK-only,
single-warehouse scope): resolved via
`TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID` if set (an invalid
configured id is `INVALID_CONFIGURED_STOCK_LOCATION`, never silently
falling back), otherwise auto-picked only if exactly one Medusa stock
location exists (`NO_STOCK_LOCATION` / `AMBIGUOUS_STOCK_LOCATION`
otherwise). A stock location is never auto-created.

Every failure path returns a categorized
`MEDUSA_SYNC_ERROR_CATEGORY` values with a short, Admin-safe message; the raw
Medusa exception is logged server-side only and never persisted into
`medusa_sync_last_error` or returned through the Admin API.

**Concurrency.** `beginMedusaSyncAttempt` mints a fresh attempt token,
persists it on the proposal row (`medusa_sync_attempt_token`), and refuses
(returns a null token) if the proposal is already `SYNCED` or already has an
active, non-expired `PENDING` token; non-`APPLIED` proposals are rejected —
this is the sole guard against the retry endpoint spawning parallel
uncontrolled retries. `recordMedusaSyncResult` discards any result whose
`attemptToken` no longer matches the row's *current* token (a superseded
attempt's late result), never regresses `SYNCED` back to `FAILED`, and no-ops
a duplicate `SYNCED` callback. Recording either success or failure clears
the active token. Two concurrent sync/retry calls serialize under the row
lock, so exactly one mints a token and performs the downstream write; the
other receives a null token and stops.
An attempt token has a five-minute lease. If a worker terminates after
claiming an attempt but before recording its result, a later retry may mint a
new token after the lease; any late result from the interrupted worker is then
stale and ignored.

### Deterministic snapshot-progress aggregation

`computeInventorySnapshotProgress` (`modules/trading-card-inventory/reconciliation/snapshot-progress.ts`)
is a pure function, the single source of truth for whether a snapshot may be
reported or transitioned as fully applied. It buckets every proposal into
`pending` / `approved` (unapplied, baseline still valid) / `rejected` /
`appliedFullySynced` / `appliedSyncPending` / `appliedSyncFailed` / `blocked`
(approved, baseline has drifted since reconciliation) / `outOfScope`
(`PRICE_CHANGE`/`COST_CHANGE`/`NO_CHANGE`/`UNRESOLVED_VARIANT` — never gate
completion). The invariant this stage is built around:

> **A snapshot must never be reported or transitioned as `APPLIED` while any
> locally-applied proposal still has `PENDING` or `FAILED` Medusa sync.**

`fullyComplete = allApplicableApplied && appliedSyncPending === 0 && appliedSyncFailed === 0`,
where `allApplicableApplied = allReviewed && approved === 0 && blocked === 0`.
This is recomputed fresh from DB state after every review, apply, and
sync-retry operation (`advanceSnapshotProgressIfComplete`); only when
`fullyComplete` newly holds does the snapshot transition
`APPROVED → APPLYING → APPLIED`. A snapshot outside `{APPROVED, APPLYING,
APPLIED}` is left untouched — this helper never forces an invalid transition
to paper over an unexpected state. No new `InventorySnapshotStatus` value was
added; the existing states already correctly describe the snapshot's own
reconciliation/apply-gate lifecycle.

### Review: all-or-nothing bulk, applier identity never client-supplied

`reviewInventoryProposals` (bulk approve/reject, also used for the single-id
case) is all-or-nothing: any non-`PENDING` row in the batch aborts the whole
batch, naming the offending id, before anything is written. Reviewer/applier
identity is always `adminActor(req)` (the authenticated Medusa Admin user),
never accepted from the request body — every Admin API body schema is
`.strict()` with no `actor`/`reviewedBy` field defined.

### Bulk apply: per-item partial success

`applyInventoryProposals` loops `applyInventoryProposal` per id, each its own
transaction, so one stale/invalid proposal never blocks the others. The HTTP
layer returns 200 whenever the request itself was valid; per-item outcomes
(`APPLIED`/`ALREADY_APPLIED`/`STALE_BASELINE`/`INVALID_STATE`/`OUT_OF_SCOPE`,
plus the resulting `medusaSyncStatus`) live in the response body, not the
HTTP status.

## Consequences

- Real Medusa inventory writes now happen from this module, gated only by
  proposal state and the stock-location/link-resolution guards above — not
  behind a feature flag, per explicit instruction.
- No pricing/cost mutation, no product creation or publication, no eBay
  sync, no order-driven stock decrement, no new RBAC/permission model, and no
  automatic (unattended) approval or application were added — all remain out
  of scope.
- No HTTP-level (supertest-style) integration test harness exists anywhere
  in this repository yet; the new Admin routes are covered indirectly via
  the underlying service/workflow integration tests, which exercise the same
  logic against a real database and a real, seeded `MedusaApp` instance
  (including product, inventory, and stock-location modules) rather than
  through actual HTTP requests.
- Per-row "blocked" (stale-baseline) status is exposed only as an aggregate
  count in the Admin UI (`SnapshotProgress.blocked`), not per proposal row —
  extending `computeInventorySnapshotProgress` to return blocked proposal ids
  is a reasonable, small follow-up, not added here to keep this stage's
  surface area to what was specified.
