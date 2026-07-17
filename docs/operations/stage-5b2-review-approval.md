# Stage 5B.2 - Inventory proposal review, approval, application and Medusa sync

Stage 5B.2 closes the gap Stage 5A.2/5B.1 deliberately left open: an
`InventoryProposal` can now be reviewed (approved/rejected), applied (an
atomic, authoritative local stock movement), and reflected into Medusa's own
inventory system. See [ADR 0011](../decisions/0011-inventory-proposal-application-and-medusa-sync.md)
for the full design rationale.

## Review

- `POST /admin/trading-card-inventory/proposals/:id/review` — single
  approve/reject. Body: `{ targetStatus: "APPROVED"|"REJECTED", rejectionReason?, reviewNote? }`.
- `POST /admin/trading-card-inventory/proposals/review` — bulk, all-or-nothing.
  Body: `{ ids, targetStatus, rejectionReason?, reviewNote? }`. Any non-`PENDING`
  id in the batch aborts the whole request; nothing is written.
- Reviewer identity is always the authenticated Admin user
  (`adminActor(req)`) — every body schema is `.strict()` with no
  `actor`/`reviewedBy` field.

## Apply

- `POST /admin/trading-card-inventory/proposals/:id/apply` — single. No body.
  Always 200 when the request itself is valid; the result body's
  `localApplicationStatus` (`APPLIED`/`ALREADY_APPLIED`/`STALE_BASELINE`/
  `INVALID_STATE`/`OUT_OF_SCOPE`) and `medusaSyncStatus` carry the actual
  outcome — a Medusa sync failure does not make this a non-2xx response,
  since the local, authoritative stock movement already succeeded on its own
  terms.
- `POST /admin/trading-card-inventory/proposals/apply` — bulk, per-item
  partial success. Body: `{ ids }`. One stale/invalid proposal never blocks
  the others; response is `{ results: ApplyProposalItemResult[] }`.
- Only `NEW_HOLDING`/`QUANTITY_CHANGE` proposals are ever applied.
  `PRICE_CHANGE`/`COST_CHANGE`/`NO_CHANGE`/`UNRESOLVED_VARIANT` are rejected
  as `OUT_OF_SCOPE` without mutation.
- Re-applying an already-`APPLIED` proposal is an idempotent no-op success
  (`ALREADY_APPLIED`) — no duplicate ledger row, no duplicate holding
  movement.

## Medusa sync

Applying a proposal automatically attempts to reflect the resulting quantity
into Medusa (Phase B), tracked independently of the local application
(Phase A) via `medusa_sync_status` (`NOT_APPLICABLE` → `PENDING` →
`SYNCED`|`FAILED`).

- `POST /admin/trading-card-inventory/proposals/:id/retry-sync` — retries
  Phase B only, never re-runs Phase A.
  - `409` — nothing eligible to retry (`medusa_sync_status` isn't `FAILED`,
    or a concurrent retry already claimed the current attempt token).
  - `502` — the retry reached Medusa but failed again; the response body
    still includes the proposal with its (still-`FAILED`) sync state and the
    categorized error.
  - `200` — synced.
- Stock location: set `TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID` to
  pin a specific Medusa stock location. If unset, the sync auto-picks the
  location only when exactly one exists in Medusa, and fails explicitly
  (`NO_STOCK_LOCATION` / `AMBIGUOUS_STOCK_LOCATION`) otherwise. A stock
  location is **never** auto-created.
- Failure categories (`medusa_sync_last_error.category`, all Admin-safe, no
  raw Medusa exception ever persisted or returned):
  `INVALID_CONFIGURED_STOCK_LOCATION`, `NO_STOCK_LOCATION`,
  `AMBIGUOUS_STOCK_LOCATION`, `NO_PRODUCT_VARIANT_LINK`,
  `NO_INVENTORY_ITEM_LINK`, `MEDUSA_LEVEL_READ_FAILED`,
  `MEDUSA_LEVEL_CREATE_FAILED`, `MEDUSA_LEVEL_UPDATE_FAILED`.
- The quantity written to Medusa is always the **absolute resulting
  quantity** (`stocked_quantity`), never a relative delta.

## Snapshot progress

`GET /admin/trading-card-inventory/imports/snapshots/:id/summary` now
includes a live-computed `progress` object (never a stored field, so it can
never drift):

```
{ totalProposals, pending, approved, rejected, appliedFullySynced,
  appliedSyncPending, appliedSyncFailed, blocked, outOfScope,
  allReviewed, allApplicableApplied, fullyComplete }
```

A snapshot is only ever moved `APPROVED → APPLYING → APPLIED` automatically,
by the same code path that recomputes this object, and only when
`fullyComplete` is true — meaning every applicable proposal has been applied
**and** synced (or is out of scope). `blocked` proposals (approved, but the
live holding quantity has drifted from the expected baseline since
reconciliation) are never auto-resolved; they require re-approval via
reconciliation.

## Audit history

`GET /admin/trading-card-inventory/proposals/:id` returns the proposal plus
a bounded (`limit`, default 50, max 100), newest-first audit-history
timeline covering: `PROPOSAL_CREATED`, `PROPOSAL_REVIEWED`,
`PROPOSAL_APPLICATION_ATTEMPTED`, `PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE`,
`PROPOSAL_APPLIED`, `PROPOSAL_APPLICATION_RETRIED`, `MEDUSA_SYNC_SUCCEEDED`,
`MEDUSA_SYNC_FAILED`. Entries are allow-listed (`toSafeInventoryAuditEntryDto`)
— `old_value`/`new_value` are already-bounded structured JSON written by the
service layer, never a raw exception.

## Admin UI

- **`/imports/snapshots`** — new minimal snapshot list (table + status,
  navigation only). The imports overview's "4. Check and approve" card now
  links here (previously pointed at `/imports/review`, the unrelated Stage
  4A.4 TCGdex proposal-review page).
- **`/imports/snapshots/:id`** — extended with a live `SnapshotProgress`
  summary and a link into the new proposals page.
- **`/imports/snapshots/:id/proposals`** — the review/apply workspace:
  checkbox row selection with bulk approve/reject (all-or-nothing) and bulk
  apply (per-item partial success); per-row actions gated on
  `(reviewStatus, medusaSyncStatus)` (Approve/Reject while `PENDING`, Apply
  while `APPROVED`, Retry sync only while `APPLIED` + sync `FAILED`); a
  combined status badge (`InventoryProposalStatusBadge`) that always shows
  both facts as independent labels ("Inventory applied — Medusa sync
  pending", "Inventory applied — Medusa sync failed", "Inventory applied and
  synchronised", "Pending review", "Approved — not yet applied", "Rejected");
  and an inline, expandable audit-history panel per proposal.

## Concurrency and idempotency guarantees

- **Apply**: the proposal id is the canonical idempotency identity. A
  caller-supplied `applicationIdempotencyKey` only resumes a genuinely
  interrupted first attempt for *that* proposal; a different key can never
  cause a double-apply.
- **Sync retry**: `beginMedusaSyncAttempt` mints and persists a fresh attempt
  token before each sync attempt, refusing to mint one if the proposal is
  already `SYNCED`. `recordMedusaSyncResult` discards any result whose token
  doesn't match the row's *current* token (a stale/superseded attempt),
  never regresses `SYNCED` back to `FAILED`, and no-ops a duplicate `SYNCED`
  callback. At most one retry ever proceeds past the token check for a given
  proposal at a time.
- **NEW_HOLDING race**: Phase A always re-reads the holding row live, even
  for a `NEW_HOLDING` proposal — it never assumes "no holding exists" from
  `change_kind` alone.

## Explicit exclusions (confirmed out of scope)

Automatic (unattended) approval/application; pricing/cost changes to
holdings; eBay sync; Pulse market-price API integration; product creation or
publication; storefront inventory UI; order-driven stock decrements;
sell-to-us ingestion; financial accounting; refunds; purchase orders; any
Stage 5C+ functionality; a new RBAC/permission model; auto-created stock
locations; new `InventorySnapshotStatus` enum values.

## Testing

- Migration tests: `proposal-application-migration.integration.spec.ts` —
  new columns/constraints reversibility, audit-action CHECK widen/restore.
- `snapshot-progress.unit.spec.ts` — every branch of
  `computeInventorySnapshotProgress` (all-pending, mixed, all-reviewed,
  sync-pending, sync-failed, fully-complete, stale/blocked baseline,
  out-of-scope change kinds, empty set).
- `trading-card-inventory-module.spec.ts` — `reviewInventoryProposals`
  (bulk all-or-nothing), `applyInventoryProposal`/`applyInventoryProposals`
  (Phase A idempotency, stale baseline, out-of-scope rejection, bulk partial
  success), `beginMedusaSyncAttempt`/`recordMedusaSyncResult` (attempt-token
  staleness, no-regress-from-SYNCED, duplicate-success no-op).
- `medusa-inventory-sync.integration.spec.ts` — a real, seeded `MedusaApp`
  instance (product, inventory, stock-location, trading-cards, and
  trading-card-inventory modules together): the exact
  `product_variant.inventory_items` link-pivot field shape; every stock-location
  resolution path (auto-pick-sole, ambiguous, invalid-configured); every
  link-resolution failure category; absolute-quantity create-then-update
  behaviour; and a full end-to-end review → apply → Medusa sync → snapshot
  `APPLIED` flow, plus a failed-sync → retry → synced flow that confirms the
  retry never re-runs Phase A (`applied_transaction_id` unchanged across the
  retry).
- Admin component tests (`page.component.spec.tsx`): proposal list
  rendering with combined badges and progress counts; single approve/apply;
  bulk-select and bulk-approve; sync-status-gated retry action visibility;
  history panel expand/collapse; snapshot list rendering and navigation.

## Known limitations

- No HTTP-level (supertest-style) integration tests exist anywhere in this
  repository yet (`integration-tests/http/` is empty, pre-dating this
  stage). The new Admin routes are covered indirectly via the underlying
  service/workflow integration tests rather than direct HTTP request tests.
- Per-row "blocked" (stale-baseline) status is surfaced in the Admin UI only
  as an aggregate count, not per proposal row.
- Browser-driven manual testing of the Admin UI was not performed in this
  environment (no display server available); verified via its component
  test suite (Testing Library + jsdom) instead.
