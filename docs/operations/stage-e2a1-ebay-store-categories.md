# Stage E2A1 eBay Store categories

This is a local mirror only. It makes no eBay, listing, stock, price or publication change.

Select a connected Sandbox or Production seller account, then add categories manually or preview a complete CSV before applying it. Preview may record bounded audit metadata, but it does not mutate the catalogue. Applying is atomic and cryptographically bound to the server-issued preview, authenticated actor, exact CSV bytes and catalogue state. If the CSV, environment or catalogue changes, or the preview expires or has already been consumed, preview again. A failed import changes nothing. A full successful import soft-removes active categories missing from the file. Removed categories remain visible and historical.

In Admin, use **Settings → eBay Store categories**. The page shows the full local path, exact text ID, hierarchy level, sibling order, source, status and update time. Manual removal requires a reason and confirmation; it affects only this local mirror. The CSV area provides a preview, validation counts, and an example download before the explicit apply action.

CSV header must exactly be:

```csv
ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order
24393782015,Black Star Promo Cards,,10
24393788015,Mega Evolution Promos,24393782015,10
```

IDs are text and must never be converted to numbers. Names are required, roots have blank parents, and sibling order is a non-negative integer. Because the CSV is a complete snapshot, every non-root parent must be included in the same file; cycles, duplicates, self-parenting and depth greater than three are rejected. Local removal follows parent IDs within the selected environment and seller account, never display-path or name prefixes. To recover from a mistaken import, preview and import the intended complete hierarchy again; the system preserves historical removed records rather than deleting them.

## Audit history

The Admin page shows the latest safe audit history for the selected environment and connected seller account. History is read-only and account-scoped. It includes actor, timestamp, action, category record identity, manual before/after values, subtree-removal reason and affected IDs, and complete-import outcome summaries plus category-level changes.

Store-category changes are allowed only through the documented manual and confirmed-import controls. Generated persistence methods are blocked, and audit rows are append-only. Preview auditing records bounded metadata but never changes the catalogue. Import history stores the preview ID and CSV SHA-256, never the raw CSV. OAuth data, access or refresh tokens, encrypted credentials, provider payloads, secrets and internal stack traces are intentionally excluded. Audit rows are retained with the local catalogue history; E2A1 provides no Admin mutation or deletion endpoint for them.
