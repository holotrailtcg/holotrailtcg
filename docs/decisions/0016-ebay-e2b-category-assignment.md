# 0016 — eBay E2B: category assignment rules, Medusa category sync, Pulse approval integration

## Status

Implemented on `feat/ebay-e2b-category-assignment`.

## Context

E2A1 gave us a local, canonical eBay Store Category catalogue
(`EbayStoreCategory`). Nothing yet linked that catalogue to Medusa's own
Product Category tree, and Pulse import approval had no concept of a
category at all. E2B closes both gaps for **new** Pulse rows only —
existing approved products are not touched.

## Decisions

1. **Stable link stored directly on `EbayStoreCategory`.** A `medusa_category_id`
   (+ `medusa_category_synced_at`) column was added to the existing model
   rather than introducing a Medusa module link (`defineLink`) to
   `ProductCategory`. The repo has no existing link to `ProductCategory` to
   follow, and a plain id column is enough to satisfy "store the stable
   Medusa category link against the local record" while avoiding a new link
   migration + query-graph surface. This is a deliberate scope reduction —
   a `defineLink` could be added later if cross-module `query.graph()` joins
   between the two become necessary.

2. **Sync is a full, idempotent reconciliation, not incremental diffing.**
   `syncStoreCategoriesToMedusaWorkflow` walks every *active* local category
   in level order (parents before children) and creates/updates the linked
   Medusa Product Category as needed. Given the catalogue is small (~124
   rows), re-scanning everything on every call is simpler and safer than
   tracking dirty categories, and it is what makes the explicit "Sync
   categories to Medusa" reconciliation action and the automatic post-mutation
   sync the *same* code path.

3. **Removed categories are never deleted on the Medusa side.** A REMOVED
   local category's Medusa Product Category (if any) is left exactly as is
   — it may still be referenced by a product. This satisfies "make removed
   local categories unavailable for new assignment without deleting a Medusa
   category that is still used by a product": unavailability is enforced by
   the rule engine and the Admin category picker only ever offering ACTIVE
   local categories, not by touching Medusa.

4. **Medusa sync runs synchronously, best-effort, right after each Store
   Category mutation** (create/update/remove/CSV import) from the admin
   route handler, and is also exposed as an explicit "Sync categories to
   Medusa" Admin action for the E2A1-imported catalogue and for retrying a
   failed automatic sync. A sync failure never rolls back or blocks the
   category mutation itself — the local catalogue remains the source of
   truth even when Medusa is briefly unreachable.

5. **Assignment rules and the fallback category live in the `ebay-integration`
   module** (`EbayCategoryAssignmentRule`, `EbayCategoryAssignmentSettings`),
   scoped by `(environment, ebay_account_id)`, alongside the categories they
   target. A rule has a `priority` (ascending, lowest first), an `enabled`
   flag, a target *active* Store Category, and a small AND-of-conditions
   list (`{ field, values[] }`). A rule with zero conditions can never match
   — an unconditional catch-all belongs in the dedicated fallback slot, so
   there is exactly one place to look for "what happens when nothing
   matches".

6. **Supported condition fields are constrained by what Pulse import rows
   actually persist today**: language (from the `InventorySource`, since
   Pulse sources are single-language), finish, special treatment, and
   rarity (from the snapshot entry's parsed candidates), and set
   code/name (only once a `TradingCardVariant` is resolved — i.e. for
   `NEW_HOLDING` proposals; `UNRESOLVED_VARIANT` rows have no set
   information yet). Card supertype/type is **not** available anywhere in
   the current Pulse pipeline and was not added as a condition field — see
   Known limitations.

7. **Category proposal computation is a second, best-effort pass after
   reconciliation**, not woven into `TradingCardInventoryModuleService
   .reconcileInventorySnapshot`'s existing (large, carefully-audited)
   transaction. `reconcileInventorySnapshotWithPriceLocks` (in the
   `reconcile-inventory-snapshot` workflow, which already has cross-module
   container access) calls the rule engine for each freshly-created
   `NEW_HOLDING`/`UNRESOLVED_VARIANT` proposal and writes the result via a
   small, additive `setProposedCategoryAssignment` service method. A failure
   here never blocks reconciliation — it just leaves the proposal without a
   proposed category, which correctly degrades to "requires a manual Admin
   choice", exactly the fallback behaviour the spec already requires for
   "no rule matched".

8. **The confirmation gate lives in two places, matching where a category
   actually becomes consequential:**
   - `applyInventoryProposal` (trading-card-inventory module) refuses to
     locally apply a `NEW_HOLDING` proposal — moving it from `INVALID_STATE`
     with a `CATEGORY_NOT_CONFIRMED` error code — unless
     `confirmed_ebay_store_category_id` is set. `QUANTITY_CHANGE` proposals
     are exempt: the underlying product was already categorised the first
     time it reached `NEW_HOLDING`.
   - `POST /admin/trading-cards/create-from-inventory-row` (the route that
     actually creates a brand-new Medusa Product for an `UNRESOLVED_VARIANT`
     row) refuses to run unless the proposal has a confirmed category that
     is *still* active right now, and passes the linked Medusa category id
     into `createCardFromInventoryRowWorkflow` so the new Product is created
     with `category_ids: [categoryId]` in the same call.
   A displayed proposal is never itself treated as confirmation — only
   `POST /admin/trading-card-inventory/proposals/:id/category` can set
   `confirmed_ebay_store_category_id`, and it re-validates the chosen
   category is still ACTIVE before accepting it.

## Known limitations (flagged for Scott)

- **No `defineLink` to `ProductCategory`** — see decision 1. Fine for now;
  revisit if a query-graph join is later needed (e.g. "which products are
  under this eBay Store category" from the Product side).
- **`NEW_HOLDING` proposals against an *already-existing* Product** (e.g. a
  second Pulse row surfacing new stock for a card manually created earlier)
  are still gated on a confirmed category by `applyInventoryProposal`, but
  confirming a category for such a proposal does **not** retroactively
  change the existing Product's category — only new-Product creation writes
  `category_ids`. This matches "no backfill / no changes to existing
  approved products", but means the reviewer's confirmation is only
  consequential for genuinely new cards. Worth revisiting if this turns out
  to be a common path in practice.
- **No card supertype/type condition field** — not present anywhere in the
  current Pulse pipeline (see decision 6). Add it as a new
  `CATEGORY_ASSIGNMENT_CONDITION_FIELD` value if/when that data becomes
  available.
- **Set code/name conditions never match for `UNRESOLVED_VARIANT` rows** —
  no `TradingCardVariant` exists yet to read a set from at proposal time.
- **Rule-scoped-per-connected-environment**: category proposal computation
  during reconciliation only runs when *exactly one* eBay environment is
  currently `CONNECTED` (there is no other unambiguous way to know which
  environment's rules apply to a Pulse import, since Pulse imports are
  entirely independent of eBay connection state). With zero or two
  connected environments, proposals are simply left without a computed
  category — degrading, as designed, to "requires a manual Admin choice".
- **Admin UI is functional but minimal**: the category-rules page uses a
  one-condition-per-rule editor (the API supports multiple AND-ed
  conditions); the proposal category review page
  (`/app/imports/proposals/:proposalId/category`) is a standalone route not
  yet linked from the main proposals table — reach it directly using a
  proposal id from that table. Both are safe, additive UI surfaces chosen
  over risking a blind edit to the existing, much larger proposals table
  component.
