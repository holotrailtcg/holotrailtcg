# 0008 — Inventory domain foundation

- **Status:** Accepted
- **Date:** 2026-07-16
- **Stage:** 5A.1 (inventory bounded-context foundation)

## Context

Pulse is Holo Trail's operational inventory-management system. A future
stage will accept complete Pulse CSV snapshots, reconcile them against a
previously approved snapshot, and only after explicit Admin approval update
Medusa's own commerce stock. Before any parsing, reconciliation, or stock
mutation can be built safely, the domain needs a persistence layer capable
of representing named inventory sources, complete snapshots and their
lifecycle, source-specific grouped holdings, draft proposed changes, and an
append-only ledger of applied stock movements — entirely separate from
Medusa's commerce inventory module, and without importing a single CSV row.

Four real Pulse exports (`ch.csv`, `jp.csv`, `swsh.csv`, `me_reduced.csv`)
were inspected directly to ground this design. They confirm the same
characteristics Stage 3 (ADR 0007) already recorded from its own fixture
analysis: header columns `Product Name, Set, Card Number, Material, Promo
Info, Rarity, Graded By, Grade, Item Type, Product ID, Quantity, Avg Cost,
Market Price, Sticker Price, Total Cost, Total Market Value, Total Sticker
Value, Profit, Margin %, Markup vs Market %`; the same Product ID repeating
across multiple rows (e.g. `card:cbb2_scn|0704/15|Poke Ball|null|null|null`
three times in the Chinese export); blank `Material`; `Avg Cost` legitimately
zero; condition sometimes suffixed onto the Product ID (`|lp` in the Japanese
export); `Rarity` sometimes the literal string `"Unknown"`. No new raw CSV
was committed to the repository — these are pre-existing local fixtures, not
part of this change.

## Decision

### Module boundary and naming

A new custom module, `trading-card-inventory`
(`apps/backend/src/modules/trading-card-inventory/`, registered as
`TRADING_CARD_INVENTORY_MODULE = "tradingCardInventory"`), owns this
bounded context. The name is deliberately distinct from Medusa's own core
`inventory` module (`Modules.INVENTORY`) — this module never reads or writes
`InventoryItem`/`StockLocation`, and the distinct key avoids any container
registration collision.

### Cross-module references, not foreign keys

Every reference to a Stage 3 `TradingCardVariant` (owned by the
`trading-cards` module) is a plain, non-FK `trading_card_variant_id` text
column. This mirrors how Stage 3 itself never creates a Postgres foreign key
into Medusa's own Product module — Medusa v2's module boundary is enforced
at the service/link layer, not by a shared-schema foreign key. Existence is
validated by three small workflows
(`apps/backend/src/workflows/trading-card-inventory/`) that resolve the
`trading-cards` module's service and call its generated
`retrieveTradingCardVariant` before the inventory-module transaction starts:
`upsertInventoryHoldingWorkflow`, `createInventoryProposalWorkflow` (skips
validation when the variant is legitimately unresolved), and
`appendInventoryTransactionWorkflow`. One Medusa module link,
`InventoryHolding` ↔ `TradingCardVariant` (both sides `isList: false`,
`apps/backend/src/links/inventory-holding-trading-card-variant.ts`), exists
purely so Admin reads can traverse from a variant to its holdings via
`query.graph()`; many holdings (one per source) may link to the same
variant.

### Six domain tables, one migration

`Migration20260716090000` creates six tables, all additive, none touching
Stage 3/4A/4B:

- **`InventorySource`** — a named Pulse (or future) inventory. `provider`
  is an open-ended enum (`PULSE`, `OTHER`) so the model never gains
  Pulse-specific columns. Duplicate-name protection uses a stored,
  service-computed `normalized_name` (lowercased, trimmed, whitespace
  collapsed) with a unique index — the same pattern Stage 3 uses for SKU,
  never a Postgres expression index. Also carries source-level
  configuration reserved for later stages: `default_currency_code`,
  `default_pricing_profile_key`, `default_storefront_category_id`, `notes`
  — stored now, not yet read by any Stage 5A.1 logic.
- **`InventorySnapshot`** — one complete source snapshot. A 9-state
  lifecycle (`DRAFT → VALIDATED → PENDING_REVIEW → APPROVED → APPLYING →
  APPLIED`, with terminal `REJECTED`/`FAILED`/`SUPERSEDED`) with an explicit,
  service-enforced transition table — no CSV parser exists yet, so nothing
  drives these transitions automatically this stage. A partial unique index
  on `(inventory_source_id)` where `status = 'APPLYING'` is the direct
  "protection against duplicate applied snapshots" invariant; a partial
  unique index on `(inventory_source_id, content_hash)` excluding
  `REJECTED`/`FAILED` snapshots blocks a duplicate *live* upload while still
  allowing a legitimate re-upload after rejection.
- **`InventoryHolding`** — a source-specific grouped holding for one
  trading-card variant. Unique per `(inventory_source_id,
  trading_card_variant_id)`. Money fields (`unit_acquisition_cost`,
  `unit_market_price`, `unit_selling_price`) use `model.bigNumber()`
  (Postgres `numeric`, the same representation Medusa's own `Price.amount`
  uses) with a shared `currency_code`, never floating point. A `status`
  axis (`DRAFT` / `READY` / `ARCHIVED`) is deliberately separate from
  publish readiness: `READY` means this holding's quantity/pricing are
  confirmed and it counts toward the readiness "approved quantity" signal;
  `ARCHIVED` means "stop selling from this holding" without touching
  quantity, cost fields, or the transaction ledger, and is fully reversible.
- **`InventoryProposal`** — a draft change-set row capable of representing
  an unresolved variant (`trading_card_variant_id` nullable, `change_kind =
  'UNRESOLVED_VARIANT'` enforced by a CHECK constraint), a new holding, a
  quantity/cost/price change, or no change, each with an explicit
  `review_status` lifecycle (`PENDING → APPROVED|REJECTED`, `APPROVED →
  APPLIED`). Pre-resolution identity uses a provider-neutral
  `provider_reference` + `provider_reference_type` pair rather than a
  Pulse-specific field, so a future non-Pulse import or a manually created
  proposal never needs a Pulse-only column on the core model.
- **`InventoryTransaction`** — an append-only ledger of applied stock
  movements. `inventory_source`/`inventory_holding`/`inventory_snapshot` are
  all nullable, deliberately: future reasons such as `WEBSITE_SALE` and
  `EBAY_SALE` are not scoped to any Pulse source, so the schema must not
  block them later. A CHECK constraint enforces `quantity_after =
  quantity_before + quantity_delta`; an optional `idempotency_key` makes a
  repeated apply return the existing row rather than double-counting.
  `MedusaService`'s generated bulk create/update/delete/soft-delete/restore
  methods are all overridden to throw `NOT_ALLOWED` — every write goes
  through one explicit `appendInventoryTransaction` service method, mirroring
  how Stage 3 locks down `CardAuditEntry` and `CardImage`.
- **`InventoryAuditEntry`** — this module's own append-only audit trail,
  identical in shape and enforcement to Stage 3's `CardAuditEntry`
  (`entity_type`/`entity_id`/`action`/`old_value`/`new_value`/`reason`/
  `source`/`actor`, blocked bulk mutators, written in-transaction by a
  private `writeAudit` helper). This is a **second physical table**, not an
  extension of Stage 3's `trading_card_audit_entry` — Stage 3's audit
  guarantee ("mutation and audit share one transaction") is tied to the
  `trading-cards` module's own database transaction, and Medusa modules do
  not share transactions across module boundaries. Writing into another
  module's audit table from this module's transaction would silently break
  that invariant. Reusing the identical *pattern* (append-only, same-entity
  audit rows, blocked generic mutators) is the closest safe analogue given
  Medusa v2's per-module transaction boundary, and is recorded here as a
  deliberate choice rather than an unreviewed inconsistency.

### Publish readiness stays a live computation, never a stored flag

`getPublishReadiness()` (`readiness/get-publish-readiness.ts`) is a plain
function, not a module service method or a persisted column, because it
composes three separate things a single module service cannot reach: the
`trading-cards` module's service (canonical rarity, READY image count), the
Medusa `query.graph()` (linked product/product-variant), and this module's
own holding/proposal state. It returns an explicit blocker enum
(`NO_LINKED_PRODUCT`, `NO_LINKED_PRODUCT_VARIANT`, `NO_APPROVED_TCGDEX_DATA`,
`NO_READY_IMAGE`, `ZERO_APPROVED_QUANTITY`,
`INVALID_OR_MISSING_SELLING_PRICE`, `UNRESOLVED_PENDING_PROPOSAL`) rather
than a single boolean, so a caller always knows *why* a variant is not
ready. Always computed live: a card can flip from ready to blocked (or back)
the moment an image is archived or a source is archived, with no stored flag
to fall out of sync.

### Medusa inventory relationship — documented only

Medusa's `ProductVariantInventoryItem` link (linking `ProductVariant` to
`InventoryItem`) already exists as a built-in core link; this stage adds no
code that reads or writes it. The intended future chain is:
`TradingCardVariant` → Medusa `ProductVariant` → Medusa `InventoryItem` →
`StockLocation`, with an approved `InventoryHolding.quantity` feeding a
later stage's write to `InventoryItem` stock levels only after Admin
approval. Stage 5A.1 performs no such write, and no code path in this stage
can reach Medusa's inventory module.

### Admin surface

Read-only, plus minimal validated source management, under
`/admin/trading-card-inventory/`: `GET`/`POST /sources`, `POST
/sources/:id/{rename,archive,restore}`, `GET /sources/:id/summary`, `GET
/transactions`, `GET /variants/:variantId/publish-readiness`. No
holding/snapshot/proposal-creation or holding-status-change route exists —
those stay service/test-only this stage, matching the explicit
CSV-upload-workflow exclusion. Every route follows the Stage 3/4A/4B
convention: Medusa's default `/admin/*` authentication, zod-validated input
via a shared `parseAdminInput`, `safeAdminRead`/`safeAdminWrite` error
shaping, and an explicit allow-listed DTO (`toSafeInventorySourceDto`,
`toSafeInventoryTransactionDto`) that never exposes `provider_metadata` or
other internal jsonb payloads.

## Known limitations and exclusions

- Money fields are written via raw parameterised SQL (matching Stage 3's
  convention for all other mutations), so the DML-generated `raw_<field>`
  jsonb companion column is left null on every row this stage writes.
  Reads still resolve correctly (MikroORM's `BigNumberNumeric` hydrates the
  primary `numeric` column directly), but a later stage introducing
  precision-sensitive weighted-average arithmetic should populate
  `raw_<field>` deliberately rather than assume it is already populated.
- CSV upload, parsing, validation, duplicate-row grouping, weighted-average
  cost calculation, complete-snapshot comparison, missing-card-to-zero
  logic, the reconciliation engine, and any Medusa stock mutation are all
  explicitly out of scope and deferred to Stage 5A.2 and later.
- The `InventorySnapshot` and `InventoryProposal` lifecycle states exist and
  are transition-validated, but nothing in this stage populates them from a
  real CSV — they are proven with directly-created rows in tests.
