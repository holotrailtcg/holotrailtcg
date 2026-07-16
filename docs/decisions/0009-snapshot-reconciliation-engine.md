# ADR 0009: Snapshot reconciliation engine

## Status

Accepted for Stage 5A.2.

## Context

Stage 5A.1 created inventory sources, snapshot metadata, grouped holdings,
draft proposals, the append-only ledger, and audit records. It deliberately
did not persist normalized snapshot rows or compare complete snapshots.

Stage 5A.2 must compare several thousand normalized rows deterministically,
retain duplicate provider rows long enough to aggregate them, suggest locked
price changes without applying them, and create no duplicate proposals under
retry or concurrency.

## Decision

- `InventorySnapshotEntry` is an immutable, normalized snapshot fact. It
  stores only bounded comparison fields and never stores a raw CSV row or raw
  snapshot payload. Duplicate `(snapshot, provider reference type, provider
  reference)` rows are intentionally allowed.
- The provider-neutral engine groups by provider reference type plus provider
  reference. Quantity is summed. Acquisition cost is
  `sum(unit cost * quantity) / sum(quantity)`, calculated with `BigInt` decimal
  arithmetic and deterministic half-up rounding to at least six fractional
  digits. No floating-point arithmetic participates in aggregation.
- Duplicate market and selling prices must normally agree. If they do not,
  the deterministic maximum observation is retained; diagnostics expose the
  duplicate-row count. Mixed currencies and conflicting/missing variant
  matches become `UNRESOLVED_VARIANT` rather than aborting the reconciliation.
- One minimal proposal is created per grouped reference. If several fields
  changed, the primary kind is selected in this order: `QUANTITY_CHANGE`,
  `COST_CHANGE`, then `PRICE_CHANGE`; the bounded `changedFields` diagnostic
  retains every detected dimension. An identical group creates `NO_CHANGE`,
  which is an audit/review observation and performs no holding update.
- A missing group retains its last observed commercial values but proposes
  quantity zero. It is never deleted.
- The Stage 3 workflow bulk-loads distinct variant IDs and price-lock state in
  one query per module. A locked selling-price difference remains a suggestion
  in a draft proposal and is explicitly marked in diagnostics.
- Reconciliation holds a PostgreSQL transaction-scoped advisory lock for the
  inventory source (preventing overlapping source reconciliations) and locks
  the new snapshot row. Proposal writes are chunked. A unique
  `(inventory_snapshot_id, reconciliation_key)` index is the final duplicate
  guard. A retry returns the persisted summary; a different baseline is
  rejected.
- A baseline must belong to the same source, precede the new snapshot, have an
  approval timestamp, and not be rejected or failed. The new snapshot must be
  `VALIDATED`; successful comparison moves it to `PENDING_REVIEW` atomically.

## Consequences

The engine creates draft proposals only. It does not approve, reject, apply,
publish, update holdings, write the transaction ledger, call Pulse, parse CSV,
or access Medusa `InventoryItem`/`StockLocation` services. Stage 5B remains
responsible for reviewed application and any later stock synchronization.
