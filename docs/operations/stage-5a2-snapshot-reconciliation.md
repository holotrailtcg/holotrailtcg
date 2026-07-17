# Stage 5A.2 - snapshot reconciliation

Stage 5A.2 compares normalized complete snapshots and writes draft inventory
proposals. See [ADR 0009](../decisions/0009-snapshot-reconciliation-engine.md)
for the schema and concurrency decisions.

## Lifecycle

1. A later importer or a test creates a `DRAFT` snapshot and appends bounded,
   normalized `InventorySnapshotEntry` rows.
2. Structural validation moves the snapshot to `VALIDATED`.
3. `reconcileInventorySnapshotWorkflow` bulk-loads Stage 3 price locks and
   invokes the provider-neutral module service.
4. The service validates an optional approved baseline, aggregates duplicates,
   compares maps in memory, writes proposals in batches, and atomically moves
   the new snapshot to `PENDING_REVIEW`.
5. Admin users may read reconciliation summaries, proposal summaries, counts,
   and filtered/paginated proposal rows. There are no Admin mutation routes.

## Read-only Admin API

- `GET /admin/trading-card-inventory/snapshots/:id/reconciliation-summary`
- `GET /admin/trading-card-inventory/proposals`
- `GET /admin/trading-card-inventory/proposals/summary?inventorySnapshotId=...`

Proposal filters are `inventorySourceId`, `inventorySnapshotId`,
`tradingCardVariantId`, `changeKind`, and `reviewStatus`. Page sizes are capped
at 100. Responses are explicit allow-listed DTOs; reconciliation diagnostics
contain at most eight changed-field names and small scalar flags.

## Operational guarantees

- Repeating the same snapshot pair returns the same persisted summary and
  creates no additional proposals.
- Concurrent attempts for one inventory source serialize on a
  transaction-scoped advisory lock; a database uniqueness constraint is the
  final duplicate-proposal guard.
- Rejected, failed, or superseded snapshots cannot be baselines. When the
  caller omits a baseline, reconciliation selects the latest eligible
  approved prior snapshot; an explicit older baseline is rejected.
- Missing holdings produce quantity-zero draft proposals; they are not deleted.
- Price locks are reported and remain authoritative. No public price changes.
- No CSV upload/parser, approval action, holding mutation, Medusa stock write,
  storefront visibility change, or external-provider call exists in this stage.
