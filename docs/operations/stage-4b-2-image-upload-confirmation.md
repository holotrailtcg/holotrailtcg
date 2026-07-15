# Stage 4B.2 — secure card-image upload and confirmation

Stage 4B.2 builds the complete secure upload pipeline on top of the
`CardImage` data model, lifecycle CHECK constraints, object-key helpers, and
disabled-by-default R2 configuration Stage 4B.1 established (see
`docs/operations/stage-4b-1-image-domain-r2.md`). It adds the two Admin
routes, the real presigned-URL/R2 client, and the confirmation pipeline that
transitions a `PENDING` `CardImage` row to `READY`, `DUPLICATE`, `REJECTED`,
or `EXPIRED`. It does not add Admin image pages, storefront image display,
image editing (crop/resize), thumbnails, or any background worker.

## Upload flow

1. **Request an upload** — `POST /admin/trading-cards/variants/:variantId/images/upload`.
   The backend verifies Admin authentication (Medusa's default `/admin/*`
   auth), verifies the variant exists, creates a `PENDING` `CardImage` row
   (`TradingCardsModuleService.createPendingCardImage`, unchanged from Stage
   4B.1) with a server-generated staging object key, and asks R2 for a
   presigned `PutObject` URL for that exact key, valid for 15 minutes. It
   returns `{ uploadUrl, objectKey, imageId, expiresAt, requiredHeaders }`.
   The browser never chooses the object key.
2. **Upload directly to R2** — the browser `PUT`s the file bytes straight to
   `uploadUrl` with the `requiredHeaders` (`Content-Type`). The file never
   passes through this backend.
3. **Confirm the upload** — `POST /admin/trading-cards/images/:imageId/confirm`.
   The backend fetches the object from R2 once, validates it, strips
   metadata, auto-orients it, re-encodes it deterministically, hashes it,
   checks for a per-variant duplicate, and transitions the row to its final
   status.

## Staging vs. final objects

Staging objects live under `staging/card-images/<variantId>/<imageId>/<uuid>.<ext>`;
confirmed objects live under `card-images/<variantId>/<imageId>/<uuid>.<ext>`
(see `images/object-keys.ts`, unchanged from Stage 4B.1). A staging object is
**never synchronously deleted** — not when confirmation succeeds (the
original staging bytes are simply left in place once the re-encoded bytes
are written to the final key), and not when confirmation rejects or expires
a row. Cleaning up abandoned or superseded staging objects is a future,
separately protected background job, explicitly out of scope for this
stage — the same principle Stage 4B.1 applied to permanent deletion of an
archived `CardImage` row.

One accepted trade-off follows from keeping every R2 network call outside
the DB transaction: the final re-encoded bytes are written to R2 (via
`putObject`) *before* the transaction that checks for a per-variant
duplicate. On the rare occasion a true duplicate is found, the just-written
final-key object is orphaned (the row transitions to `DUPLICATE`, which
never references a `final_object_key`). This is harmless and consistent with
the "no synchronous cleanup" principle above.

## Confirmation pipeline in detail

Implemented in `src/modules/trading-cards/images/image-processing.ts`
(`processCardImageUpload`) and orchestrated by
`TradingCardsModuleService.confirmPendingCardImage`:

1. Fetch the object's bytes from R2 (`GetObject`). A missing object is not a
   lifecycle transition — the browser may simply not have finished
   uploading yet, and the Admin can retry the confirm call.
2. Reject a zero-byte object, or one larger than the configured limit.
3. **Magic-byte validation**: `sharp(bytes).metadata()` sniffs the format
   directly from the file's bytes via libvips — never from any
   browser-declared filename or MIME type. This *is* the magic-byte check;
   no separate `file-type` package is needed. The sniffed format is checked
   against an explicit whitelist (`jpeg`, `png`, `webp`) — a format sharp can
   parse but that isn't on the whitelist (SVG, GIF, AVIF, TIFF, BMP, HEIC,
   ...) is still rejected. A file sharp cannot parse at all (corrupted,
   truncated, or non-image bytes) is rejected the same way.
4. **Auto-orient and strip metadata**: `.rotate()` with no arguments
   auto-orients from the EXIF orientation tag and then normalises it away;
   metadata (EXIF, ICC, GPS, ...) is stripped because `.withMetadata()` is
   never called on the output pipeline — sharp strips it by default.
5. **Deterministic re-encode**, in the *source* format (never forced to a
   single output format, so PNG/WEBP transparency survives): JPEG at quality
   90 with `mozjpeg: true`, PNG at `compressionLevel: 9`, WEBP at quality 90.
6. **Hash and dimensions**: SHA-256 is computed over the **final re-encoded**
   bytes (not the original upload) — re-uploading the identical original
   file twice always produces the identical hash, since the encode settings
   are fixed constants. Width/height are read post-rotation, so a 90°/270°
   rotation is reflected correctly.
7. **Per-variant duplicate check**: under the same row lock used for every
   other `CardImage` write, the confirmed SHA-256 is compared only against
   other `READY` images on the *same* `trading_card_variant_id`. See
   "Duplicate detection scope" below.
8. **Diagnostic size check**: the fetched byte size is compared against the
   row's `declared_byte_size` (the browser's original claim at upload-request
   time). A large mismatch is **never** a rejection reason — the server only
   ever trusts the fetched bytes — but both values are always recorded on
   the confirmation's audit entry (`declaredByteSize`/`actualByteSize`) for
   later troubleshooting.

## Renamed-file handling

A file is accepted or rejected based on its **actual sniffed bytes**, never
the browser-declared `declared_mime_type`. For example, a PNG saved with a
`.jpg`-implying declared MIME type still confirms successfully with
`confirmed_mime_type: "image/png"`. Rejecting it on that technicality would
be user-hostile with no security benefit: the **final** object key is always
generated fresh at confirmation time from the confirmed (real) MIME type,
never the declared one, so a mismatched declaration never affects storage
layout or correctness.

## Supported formats and limits

- Supported: JPEG, PNG, WEBP (`SUPPORTED_IMAGE_MIME_TYPES`).
- Rejected even if parseable: SVG, GIF, AVIF, TIFF, BMP, HEIC.
- Maximum size: 10 MB (`MAX_CARD_IMAGE_BYTE_SIZE`, `src/modules/trading-cards/types.ts`) —
  enforced both on the declared size at upload-request time and on the
  actual fetched size at confirmation time.
- Upload window: 15 minutes (`CARD_IMAGE_UPLOAD_EXPIRY_MINUTES`), used both
  for the presigned URL's own expiry and the `upload_expires_at` column.
  Expiry is checked **lazily**, only when a confirm call is made after the
  window has passed — there is no background sweep. An upload that is never
  confirmed simply stays `PENDING` with an expired `upload_expires_at`
  indefinitely (its staging object also stays in R2, per "Staging vs. final
  objects" above) until a future cleanup stage addresses it.

## Duplicate detection scope

Duplicate detection is **per-variant only**: a new upload is marked
`DUPLICATE` only if another `READY` image on the *same*
`trading_card_variant_id` has the identical confirmed SHA-256. It never
compares against other variants. This matches Stage 4B.1's existing
philosophy that cross-variant image reuse is never automatic — reassigning
an existing image to a different variant would require an explicit future
Admin action, not an implicit dedup fallback.

## Security model

- The browser never uploads through this backend, and this backend never
  proxies image bytes to the browser on the way in — all upload bytes flow
  directly between the browser and R2. The backend fetches the object from
  R2 exactly once, server-side, purely to validate and re-encode it.
- The browser never chooses an object key; both the staging and final keys
  are generated server-side from the owning variant ID, the `CardImage` row
  ID, and a fresh UUID (`images/object-keys.ts`, unchanged from 4B.1).
- The presigned upload URL is scoped to one exact object key for 15 minutes.
- Both routes require standard Medusa Admin authentication
  (`/admin/*`'s default auth middleware — no separate opt-in).
- Neither route ever returns an R2 credential, the raw `staging_object_key`
  or `final_object_key`, or the `sha256_hash` to the caller — the Admin
  response DTO (`toSafeCardImageDto`) exposes only a derived `imageUrl` plus
  non-sensitive metadata (status, dimensions, sort order, focal point,
  confirmed MIME type, timestamps).
- If `R2_IMAGES_ENABLED` is not exactly `"true"`, both routes fail closed
  with a clear `NOT_ALLOWED` error rather than silently constructing a
  client that would fail later — uploads are simply unavailable in that
  environment.

## Where credentials belong

No new environment variables were introduced by this stage; the presigned
URL and confirmation-time R2 calls reuse the same `R2_*` variables Stage
4B.1 already documented. See
`docs/operations/stage-4b-1-image-domain-r2.md`'s "Credential storage"
section (and `docs/operations/environment-variables.md` for the full table)
for where they belong: only in `apps/backend/.env`, never committed, never
placed in `apps/storefront/.env.local` or behind a `NEXT_PUBLIC_` prefix.

## What's still deferred

- Permanent deletion of an archived or terminal (`REJECTED`/`DUPLICATE`/`EXPIRED`)
  `CardImage` row.
- Resizing, cropping, and marketplace-specific image derivatives; thumbnails.
- Admin image pages and storefront image display.
- Background cleanup of abandoned or superseded staging objects.
- A background expiry sweep — expiry is currently confirm-time-lazy only.
