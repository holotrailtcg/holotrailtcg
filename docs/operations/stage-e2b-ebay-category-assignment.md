# Stage E2B — eBay category assignment: manual verification

## Migrations

```bash
cd apps/backend
npx medusa db:migrate
```

Applies:
- `ebay-integration` Migration20260721090000 — adds `medusa_category_id` /
  `medusa_category_synced_at` to `ebay_integration_store_category`; creates
  `ebay_integration_category_assignment_rule` and
  `ebay_integration_category_assignment_settings`.
- `trading-card-inventory` Migration20260721093000 — adds the six category
  fields to `trading_card_inventory_proposal`.

Both are additive/nullable. No backfill runs. Existing rows are untouched.

## 1. Reconcile the already-imported E2A1 catalogue to Medusa

1. Admin → Settings → eBay → Store categories.
2. Click **"Sync categories to Medusa"**.
3. Confirm the summary shows `created` roughly matching your category count
   (first run) and `failed: 0`.
4. Re-run it — confirm the second run shows all `unchanged` (idempotent).
5. In Medusa Admin → Products → Categories, confirm the tree mirrors the
   Store Category hierarchy (parent/child + order).

## 2. Rename / re-parent / CSV import still sync automatically

1. Rename an existing category (or re-parent it) via the Store Categories
   page. Confirm the response includes a `medusaSync` summary with
   `updated: 1` (or more, if children's paths also changed).
2. Confirm the Medusa category kept the **same id** (check
   Products → Categories) — only its name/parent changed.
3. Re-import a CSV that changes the external id of an existing category
   (rename-ID scenario). Confirm the linked Medusa category is still the
   same one (no duplicate created) — this proves the stable-link design.
4. Remove a category locally. Confirm its Medusa Product Category is **not**
   deleted (check Admin), and that it no longer appears in the active
   category picker on the category-rules page or the proposal category page.

## 3. Configure assignment rules

1. Admin → Settings → eBay → eBay category rules.
2. Set a fallback category (e.g. "Other Pokémon Cards").
3. Add a rule, e.g. name "Reverse Holos", target category "Reverse Holos",
   condition Finish = `REVERSE_HOLO`, priority 10.
4. Add a second rule "Japanese Cards", target "Japanese Cards", condition
   Language = `JA`, priority 20.

## 4. Pulse import → category proposal → confirm → apply

1. Run a Pulse CSV import for a source whose language is set (EN/JA/ZH),
   containing at least one brand-new card row.
2. Reconcile the snapshot as usual. Open the resulting proposal (via the
   snapshot's proposals table) and note its id.
3. Visit `/app/imports/proposals/<proposalId>/category` (same environment
   selected in step 3). Confirm a proposed category and reason are shown
   (e.g. "Matched rule \"Reverse Holos\"", or the fallback reason, or "No
   rule matched and no fallback category is configured").
4. Either click **Accept proposal**, or pick a different active category and
   click **Confirm selected category**.
5. Attempt to apply the proposal *before* confirming a category (on a fresh
   row) — confirm it is rejected with `CATEGORY_NOT_CONFIRMED` /
   "This proposal has no confirmed eBay Store category...".
6. After confirming, approve and apply the proposal as usual. For an
   `UNRESOLVED_VARIANT` row, use "Create card" — confirm it now requires the
   confirmed category (try it before confirming — expect a 4xx with a clear
   message) and, once confirmed, that the created Medusa Product has the
   linked category assigned (Admin → Products → the new product →
   Organize → Categories).
7. Remove the confirmed category locally (Store Categories page) *after*
   confirming it on a still-pending proposal, then retry "Create card" /
   apply — confirm it is rejected because the category is no longer active.

## Known limitations to be aware of while testing

See `docs/decisions/0016-ebay-e2b-category-assignment.md` — no
`defineLink` to `ProductCategory`, no supertype/card-type condition field,
category proposal computation is skipped whenever zero or more than one
eBay environment is currently connected, and the proposal category page is
not yet linked from the main proposals table (navigate to it directly with
a proposal id).
