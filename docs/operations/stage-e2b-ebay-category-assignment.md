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
eBay environment is currently connected.

As of 2026-07-22 the proposal category page is reached via a modal from
Step 4 of the Pulse import wizard (`CategoryAssignmentDialog`) rather than
only by navigating to `/imports/proposals/<id>/category` directly, and Apply
is gated in the UI (not just the API) for any NEW_HOLDING proposal without
a confirmed category.

## Initial SANDBOX ruleset (2026-07-22)

Created via one-off scripts that have since been deleted (their real,
account-specific category ids weren't safe to keep as reusable code — see
`apps/backend/src/scripts/` cleanup, 2026-07-22). Recreate by working
through Settings → eBay → eBay category rules if this environment's rules
are ever lost; the table below is the reproducible reference.

Evaluated in ascending priority order (lowest number first); the first
matching enabled rule targeting a still-ACTIVE category wins.

| Priority | Rule | Condition(s) | Target category |
|---|---|---|---|
| 10 | Japanese cards | Language = JA | Japanese Pokémon Cards |
| 20 | Chinese cards | Language = ZH | Chinese Pokémon Cards |
| 30 | Illustration Rare — Paradox Rift | Rarity = Illustration Rare, Set = Paradox Rift | Illustration Rares & SIRs / Scarlet & Violet Series / SV04 Paradox Rift |
| 31 | Illustration Rare — Temporal Forces | Rarity = Illustration Rare, Set = Temporal Forces | .../SV05 Temporal Forces |
| 32 | Illustration Rare — Scarlet & Violet | Rarity = Illustration Rare, Set = Scarlet & Violet | .../SV01 Scarlet & Violet |
| 33 | Illustration Rare — Twilight Masquerade | Rarity = Illustration Rare, Set = Twilight Masquerade | .../SV06 Twilight Masquerade |
| 34 | Illustration Rare — Surging Sparks | Rarity = Illustration Rare, Set = Surging Sparks | .../SV08 Surging Sparks |
| 35 | Illustration Rare — Black Bolt | Rarity = Illustration Rare, Set = Black Bolt | .../SV10.5 Black Bolt |
| 40 | Illustration Rare — other sets | Rarity = Illustration Rare | Illustration Rares & SIRs (top) |
| 50 | Ultra/Hyper/Shiny Ultra/Mega Hyper rare | Rarity in {Ultra Rare, Ultra Rare Single, Hyper Rare, Shiny Ultra Rare, Mega Hyper Rare} | Ultra Rares & Full Arts |
| 60 | Promo cards | Rarity = Promo | Black Star Promo Cards |
| 61–75 | Reverse Holo — <set> | Finish = Reverse Holo, Set = <one of the 15 SV sets: Scarlet & Violet, Paldea Evolved, Obsidian Flames, Paradox Rift, Temporal Forces, Twilight Masquerade, Stellar Crown, Surging Sparks, Journey Together, Destined Rivals, Black Bolt, 151, Paldean Fates, Shrouded Fable, Prismatic Evolutions> | Reverse Holos / Scarlet & Violet Series / <matching SV set> |
| 80 | Cosmos Holo special treatment | Special Treatment = Cosmos Holo | Special Holos & Variants / Cosmos Holos |
| 90 | Reverse Holo finish | Finish = Reverse Holo | Reverse Holos (top) |

Fallback category: whatever is configured on the eBay category rules page
(was "Other Pokémon Cards" as of 2026-07-22).

**Rarity matching gotcha**: Pulse's rarity mapper
(`pulse/rarity-mapping.ts`) only produces a canonical enum value for
common/uncommon/double rare/ultra rare/ace spec/promo/no rarity — every
other rarity (Illustration Rare, Hyper Rare, Shiny Ultra Rare, Mega Hyper
Rare, Ultra Rare Single, Black White Rare) stays as Pulse's raw text
forever. Rules matching on those rarities must include both the canonical
enum value (e.g. `ILLUSTRATION_RARE`) and the raw text form (e.g.
`Illustration Rare`) as separate condition values, or they will silently
never match real data.

**Deliberately not covered**: Pokémon ex Cards, Pokémon V/VMAX/VSTAR
Cards, and Trainer Gallery — no condition field (Language/Finish/Rarity/
Special Treatment/Set Code/Set Name) can distinguish these from an
ordinary card of the same rarity. Cards that belong there fall to the
fallback category for manual assignment until a real signal exists to
rule on.
