# Stage 4B.3 — Medusa Admin image upload and assignment UI

Stage 4B.3 connects Step 3 ("Assign card images") of the four-step Admin
import shell (see
[admin-import-review-shell.md](admin-import-review-shell.md)) to the
`CardImage` domain and Admin routes Stage 4B.1
([stage-4b-1-image-domain-r2.md](stage-4b-1-image-domain-r2.md)) and Stage
4B.2 ([stage-4b-2-image-upload-confirmation.md](stage-4b-2-image-upload-confirmation.md))
already built. It adds a list of cards/variants needing images, a per-card
image workspace (upload, order, archive/restore, focal point), and the small
number of new Admin routes required to expose service functionality that
already existed (reorder/archive/restore) or was trivially added (focal
point, list/detail reads).

It does **not** add: Pulse import, storefront image display, eBay,
inventory, pricing, Stripe, thumbnails, background cleanup, drag-and-drop
reordering, image cropping, or permanent deletion of any `CardImage` row.

## Pages

- `/app/imports/images` — cards and variants needing images. Search,
  language filter, a per-card need-status filter (`No images yet` / `Some
  images missing` / `All variants have images`), pagination, and per-row
  card name, set, number, language, variant coverage, ready image count and
  need status. A `READY` card is never hidden from the list entirely — the
  status filter only changes the default view — so a fully-imaged card
  remains reachable to reorder, archive, restore or re-focus its
  photographs.
- `/app/imports/images/:tradingCardId` — a single card's image workspace: a
  variant selector (a tab per variant), the active variant's Holo Trail
  photograph gallery, a separate TCGdex reference-artwork panel, an upload
  area, and the upload queue.

## New backend routes

All under `src/api/admin/trading-cards/`, following the existing
`shared.ts`/`dependencies.ts` conventions (Zod parsing via
`parseAdminInput`, `safeAdminRead`/`safeAdminWrite`, the safe
`toSafeCardImageDto` response shape):

| Method | Path | Wraps |
| --- | --- | --- |
| `GET` | `/admin/trading-cards/needing-images` | `TradingCardsModuleService.listCardsNeedingImages` |
| `GET` | `/admin/trading-cards/:tradingCardId/images` | `TradingCardsModuleService.retrieveCardImageDetail` + `listCardImagesForVariant` per variant |
| `POST` | `/admin/trading-cards/variants/:variantId/images/reorder` | `reorderReadyCardImages` (already built in Stage 4B.1, unexposed until now) |
| `POST` | `/admin/trading-cards/images/:imageId/archive` | `archiveCardImage` (already built in Stage 4B.1) |
| `POST` | `/admin/trading-cards/images/:imageId/restore` | `restoreCardImage` (already built in Stage 4B.1) |
| `POST` | `/admin/trading-cards/images/:imageId/focal-point` | `updateCardImageFocalPoint` (new this stage) |

**No dedicated "make primary" route exists.** There is no `is_primary`
column or flag anywhere in the schema — primary is defined purely as "the
`READY` image at `sort_order = 0`" (see Stage 4B.1's unique active-sort-order
index). The Admin UI computes a reordered `orderedImageIds` array with the
target image moved to the front and calls the existing reorder route.
Adding a separate endpoint would duplicate `reorderReadyCardImages`'s
locking and validation for no benefit.

### "Cards needing images" definition

A trading card is classified by how many of its variants have at least one
`READY` `CardImage`:

- **`MISSING`** — no variant has a ready image yet.
- **`PARTIAL`** — some variants are covered, others are not.
- **`READY`** — every variant has at least one ready image.

The list query (`src/modules/trading-cards/images/admin-image-review.ts`,
mirroring the equivalent TCGdex review query module) computes this via a
`count(...) filter (where not exists (...))` aggregate per card, grouped
across all of its variants, alongside a total ready-image count and a
missing-variant count. It is deliberately one row per **card** (not per
variant), matching the list route's flat "variant details" column.

### Card detail response

The detail route returns card identity, card set, the most recent TCGdex
enrichment snapshot's `referenceArtworkUrl` (if any proposal exists for the
card, regardless of its review status — an applied proposal's snapshot is
just as valid a reference image as a pending one), and each variant's
`ready_images`/`archived_images`, each mapped through the existing
`toSafeCardImageDto` — never raw `CardImage` rows.

## Focal position

New service method `TradingCardsModuleService.updateCardImageFocalPoint`
follows the exact lock/transaction/audit shape of `archiveCardImage`/
`restoreCardImage`: it locks the owning variant row, requires the image to
be `READY` (a pending or archived image has no focal point to set), checks
`0 <= focalX, focalY <= 1` (duplicating the database's
`CK_trading_card_image_focal_bounds` check for a specific `INVALID_DATA`
error instead of a raw constraint violation), updates `focal_x`/`focal_y`,
and writes an `IMAGE_FOCAL_CHANGED` audit entry (a constant that existed
since Stage 4B.1 but was never used until this stage).

The Admin UI's `FocalPositionSelector` is a 3×3 grid of nine buttons mapped
to `{0, 0.5, 1} × {0, 0.5, 1}`, defaulting to centre (`{0.5, 0.5}`). Each
button has a descriptive `aria-label` ("Top left" … "Bottom right") and
`aria-pressed` for the selected cell, so the selection is conveyed by more
than colour. No cropping ever happens — only the two focal coordinates are
stored; how a future storefront gallery uses them for object-position
cropping is out of scope here.

## Ordering and primary image

The detail page offers "Move earlier", "Move later" and "Make primary"
buttons only — no drag-and-drop, per the approved design. All three compute
a new `orderedImageIds` array client-side
(`src/admin/components/imports/image-actions.ts`'s pure `reorderedIds`
helper) from the variant's current `ready_images` order, then POST it to the
reorder route. `visibleImageActions` (also pure, unit-tested independently)
gates which buttons show: "Move earlier"/"Make primary" are hidden on the
first ready image, "Move later" is hidden on the last, and only `READY`
images offer ordering or focal-point actions at all — `ARCHIVED` images
offer only "Restore".

The first `READY` image (`sort_order = 0`) is always primary; the Admin UI
shows a "Primary" badge on it (`isPrimary`, also a pure function).

## Archive and restore

Archiving asks for confirmation first (`usePrompt`, matching the existing
review-actions confirmation idiom, not a new dialog primitive) because it
removes the image from the active gallery; restoring does not, because it
is the safe, always-reversible direction — consistent with
`restoreCardImage` having no "are you sure" semantics at the service layer
either. Both keep the underlying `CardImage` row and its R2 object intact:
archiving only flips `status` to `ARCHIVED` and compacts the remaining
`READY` siblings' sort order; restoring appends the image back to the end
of the active order with no re-upload. Neither action, nor any other part
of this stage, ever permanently deletes a `CardImage` row or an R2 object.

## Upload flow

1. The admin picks one or more JPEG/PNG/WEBP files (a plain `<input
   type="file" multiple>` — no drag-and-drop dropzone, since only an upload
   *area* was required).
2. Each file is checked client-side first
   (`src/admin/components/imports/upload-to-r2.ts`'s `validateFileForUpload`):
   supported MIME type, non-empty, at most 10 MB. A file that fails this
   check never reaches the network.
3. For each valid file, `ImageUploadQueue` calls the existing
   `POST /admin/trading-cards/variants/:variantId/images/upload` route to
   get a presigned URL, `objectKey` and `requiredHeaders` — the browser
   never receives an R2 credential and never chooses the object key.
4. The file is `PUT` directly to R2 via `XMLHttpRequest` (not `fetch`,
   specifically to observe `upload.onprogress` for a progress percentage),
   sending exactly the `requiredHeaders` the backend returned.
5. On a successful PUT, the queue calls the existing
   `POST /admin/trading-cards/images/:imageId/confirm` route.
6. On confirmation, the relevant `card-images` and `images-needing` React
   Query keys are invalidated so the gallery, the ready-image count and the
   list's need-status badge all refresh from the real confirmed data — no
   optimistic local-state splicing.

Up to `MAX_CONCURRENT_UPLOADS` (3, `upload-to-r2.ts`) files upload at once;
the rest wait their turn in the queue. Each file's row shows its own
queued/uploading/confirming/success/error state independently, so one
failure never blocks the others.

## TCGdex reference artwork

`TcgdexReferenceArtworkPanel` renders in its own `Container`, explicitly
labelled "Reference only — not a Holo Trail photograph", and is never
rendered inside the same gallery block as a real `ReadyImageCard`. It is
sourced from the trading card's most recent TCGdex enrichment proposal
snapshot (if any); when none exists it says so rather than showing nothing
unexplained.

## Two recorded decisions

1. **Table implementation.** `CLAUDE.md`'s "Storefront and components"
   section calls for TanStack Table for complex import/review tables, but
   the existing `imports/review` list pages already use a hand-rolled
   wrapper over plain `@medusajs/ui` `Table` (`review-table.tsx`), and
   `@tanstack/react-table` is not installed anywhere in this repository.
   This stage follows the existing precedent and reuses that same
   `ReviewTable` component for the images list rather than introducing a
   second table implementation for one page.
2. **No standalone Admin TypeScript-check or Admin-only ESLint script.**
   `apps/backend/package.json` only has `lint` (`medusa lint`, repo-wide)
   and `test:unit` (which folds in `*.component.spec.tsx` files). This stage
   is verified with exactly those, plus `test:integration:http` and
   `test:integration:modules` — no new script was invented.

## What's still deferred

- Storefront image display.
- Permanent deletion of an archived or terminal `CardImage` row.
- Background cleanup of abandoned staging/final R2 objects (see Stage
  4B.2's "Failure handling and retry semantics" and "Staging vs. final
  objects" — unchanged by this stage).
- A background expiry sweep for unconfirmed uploads (unchanged from Stage
  4B.2 — still confirm-time-lazy only).
- Drag-and-drop upload or reordering; image cropping/resizing/thumbnails.
- Pulse CSV import (Step 1 of the shell remains not connected).
