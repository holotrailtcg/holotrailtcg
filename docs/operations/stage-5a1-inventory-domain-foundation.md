# Stage 5A.1 — inventory domain foundation

See [ADR 0008](../decisions/0008-inventory-domain-foundation.md) for the
architectural decisions behind this module. This document covers data
ownership, lifecycle, the Medusa relationship, publish-readiness rules, and
what remains for later stages.

## Data ownership

| Data | Owner | Notes |
| --- | --- | --- |
| Pulse operational inventory (source of truth for "what physically exists") | Pulse (external) | Holo Trail never writes back to Pulse. |
| Trading-card identity, condition, finish, treatment, rarity | Stage 3 `trading-cards` module | Referenced by ID only, never duplicated. |
| TCGdex canonical enrichment | Stage 4A (`trading-cards` module) | `TradingCard.rarity`/`rarity_icon_key`. |
| Real Holo Trail card photographs | Stage 4B (`trading-cards` module, `CardImage`) | `status = READY` is the publish-readiness signal. |
| Inventory sources, snapshots, holdings, proposals, ledger, this module's audit trail | Stage 5A.1 `trading-card-inventory` module | This document's subject. |
| Website/commerce stock, products, orders | Medusa core (`Modules.PRODUCT`, `Modules.INVENTORY`) | Not written by this module — see below. |
| Public selling price authority, price locks | Stage 3 `TradingCardVariant.price_locked*` | This module never bypasses a price lock. |

Pulse remains the operational inventory-management system. Holo Trail
receives complete, approved snapshots of it — this module never calls
Pulse's API and never treats a raw snapshot as automatically authoritative.
An `InventoryHolding` is source-specific and grouped; it is not a claim
about total physical stock across all sources, and it is not Medusa stock.

## Inventory snapshot lifecycle

```
DRAFT ──▶ VALIDATED ──▶ PENDING_REVIEW ──┬──▶ APPROVED ──▶ APPLYING ──▶ APPLIED
  │            │                          │        │                     │
  │            │                          │        └──────────────▶ SUPERSEDED
  │            │                          └──▶ REJECTED               (any later
  │            │                                                       snapshot for
  └────────────┴───────────────────────────────────▶ FAILED            the same source)
```

- `DRAFT` — created, structurally unvalidated.
- `VALIDATED` — file structure/type confirmed sound (a later stage's parser).
- `PENDING_REVIEW` — row-level proposals generated, awaiting Admin review.
- `APPROVED` — reviewer approved the proposed changes; not yet applied.
- `APPLYING` — application to holdings/ledger in progress (transient; at most
  one `APPLYING` snapshot per source at a time, enforced by a partial unique
  index).
- `APPLIED` — terminal success; holdings/ledger reflect this snapshot.
- `REJECTED` / `FAILED` / `SUPERSEDED` — terminal non-success outcomes.

Every transition is validated against an explicit table in
`modules/trading-card-inventory/types.ts`
(`INVENTORY_SNAPSHOT_STATUS_TRANSITIONS`); an invalid transition (e.g.
`DRAFT` straight to `APPROVED`) is rejected before any row is written.
Nothing in Stage 5A.1 drives these transitions automatically — they are
proven with directly-created rows in tests, ready for Stage 5A.2's parser
and reconciliation engine to drive for real.

## Inventory holding status (distinct from publish readiness)

```
DRAFT ──▶ READY ──▶ ARCHIVED
            ▲___________│
```

`DRAFT` is the initial state after creation. `READY` means this holding's
quantity/pricing are confirmed and it counts toward the publish-readiness
"approved quantity" signal. `ARCHIVED` means "stop selling from this
holding" — an explicit Admin/operational decision — without touching
quantity, cost fields, or the transaction ledger; it is fully reversible
back to `READY`. This is a different axis from publish readiness: a holding
can have quantity, an image, and approved TCGdex data, and still be
`ARCHIVED` because Holo Trail chose to stop selling it.

## Inventory proposal review status

```
PENDING ──▶ APPROVED ──▶ APPLIED
   │
   └──▶ REJECTED
```

A proposal may exist with `trading_card_variant_id = null` only when
`change_kind = 'UNRESOLVED_VARIANT'` (database-enforced) — representing a
Pulse row that could not yet be matched to a Stage 3 canonical card variant.

## Medusa inventory relationship

Stage 5A.1 performs **no Medusa stock read or write**. The intended future
chain, once a later stage is explicitly approved to build it:

```
TradingCardVariant (Stage 3)
      │  Medusa module link (trading-card-variant-product-variant.ts)
      ▼
Medusa ProductVariant
      │  Medusa's own built-in ProductVariantInventoryItem link
      ▼
Medusa InventoryItem ──▶ StockLocation (available quantity)
```

`InventoryHolding.quantity` (this module) is the Holo-Trail-approved,
source-specific count. A later, separately approved stage decides how an
approved holding's quantity is combined across sources and written into
Medusa's `InventoryItem` levels — that write does not exist yet, and this
module holds no reference to `InventoryItem` or `StockLocation` at all.

## Publish readiness

`getPublishReadiness(container, tradingCardVariantId)`
(`modules/trading-card-inventory/readiness/get-publish-readiness.ts`) is
always computed live — never a stored flag — from:

1. Stage 3: does the trading card have `rarity`/`rarity_icon_key` set
   (`NO_APPROVED_TCGDEX_DATA` if not)?
2. Stage 4B: is there at least one `CardImage` with `status = 'READY'` for
   this variant (`NO_READY_IMAGE` if not)?
3. The Medusa product link: is there a linked `ProductVariant` and, through
   it, a linked `Product` (`NO_LINKED_PRODUCT_VARIANT` /
   `NO_LINKED_PRODUCT` if not)?
4. This module: is there at least one `READY` holding with `quantity > 0`
   on an `ACTIVE` source (`ZERO_APPROVED_QUANTITY` if not — an `ARCHIVED`
   holding or an `ARCHIVED` source both correctly fall through to this same
   blocker)?
5. This module: among those approved holdings, does every one have a valid,
   positive `unit_selling_price` in a set currency
   (`INVALID_OR_MISSING_SELLING_PRICE` if not)?
6. This module: is there an unresolved `PENDING` proposal for this variant
   (`UNRESOLVED_PENDING_PROPOSAL` if so)?

The result is `{ ready: boolean, blockers: PublishReadinessBlocker[] }` —
every reason is reported, not just the first one found, so an Admin caller
can see the complete picture in one call. Stage 5A.1 exposes this only as a
read (`GET /admin/trading-card-inventory/variants/:variantId/publish-readiness`);
nothing in this stage publishes a product or changes storefront visibility.

## Deferred to Stage 5A.2 and later

- CSV upload, parsing, validation, and structural error reporting.
- Duplicate-row grouping by Pulse Product ID and weighted-average
  acquisition-cost calculation.
- Complete-snapshot comparison against the previously approved snapshot,
  including the missing-card-to-proposed-zero-quantity rule.
- The reconciliation engine that turns a snapshot into `InventoryProposal`
  rows automatically.
- The Admin approval UI/workflow that drives snapshots from `PENDING_REVIEW`
  through `APPROVED`/`APPLYING`/`APPLIED`.
- Any write to Medusa's `InventoryItem`/`StockLocation` stock levels.
- Website and eBay sale transactions in the ledger (the schema already
  supports `WEBSITE_SALE`/`EBAY_SALE` reasons with a nullable
  `inventory_source_id`, but nothing in this stage creates them).
- Pulse API integration and Pulse daily market-price refresh.
- Automatic public-price changes of any kind.
- eBay category mapping (deliberately kept separate from inventory sources).

## Confirmations

- Pulse remains the operational inventory-management source; Holo Trail
  receives complete approved snapshots of it.
- Holo Trail custom holdings (`InventoryHolding`) are source-specific and do
  not represent total physical stock across sources.
- Medusa remains the commerce stock system the website actually sells
  against; this module's holdings do not replace it.
- Stage 5A.1 does not synchronise quantities between this module and Medusa
  in either direction. Stock synchronisation begins only in a later,
  separately approved stage.
- TCGdex (via Stage 4A) owns canonical card enrichment; this module only
  reads it for publish-readiness.
- A real Holo Trail photograph (`CardImage.status = READY`, Stage 4B) remains
  mandatory for publish readiness.
- eBay category mappings are not modelled by, or coupled to, inventory
  sources.
