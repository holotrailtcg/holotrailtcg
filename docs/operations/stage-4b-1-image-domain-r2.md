# Stage 4B.1 — card-image domain and Cloudflare R2 foundation

Stage 4B.1 adds the reusable card-image data model and the Cloudflare R2
configuration foundation. It does not add upload routes, Admin image pages,
storefront image display, or any real R2 network call. Automated tests never
call R2; every test that exercises `resolveR2Config`'s enabled branch passes
an explicit fake environment object.

## Image ownership

A `CardImage` row belongs to exactly one `trading_card_variant_id` — the
exact commercial variant it depicts (for example, `Squirtle - Pokémon 151 -
English - Near Mint - Reverse Holo`), not the canonical card. This keeps a
real Holo Trail photograph attached to the exact sellable version it shows,
so the same variant can reuse its existing images the next time it is
restocked or exported to eBay, without a new upload.

Cross-variant and cross-card reuse is never automatic. `assertCardImageVariantOwnership`
is the shared guard used wherever a caller supplies both an image and the
variant it is expected to belong to; a mismatch is always rejected. Nothing in
Stage 4B.1 reassigns an existing image to a different variant — that would
require an explicit future Admin action, not an implicit fallback.

## Status lifecycle

`PENDING → READY`, with `DUPLICATE`, `REJECTED`, and `EXPIRED` as the other
possible outcomes of the confirmation step (not yet built). `READY` is the
only lifecycle state considered active/visible. `ARCHIVED` is the sole exit
from `READY`, and it is always reversible back to `READY` via
`restoreCardImage`. Stage 4B.1 does not hard-delete a `CardImage` row and does
not add any automatic purge — an archived image stays in R2 and in the
database until an explicit, separately protected permanent-deletion operation
is added in a later stage.

## Ordering and primary image

`sort_order` is zero-based and scoped to `READY` images only: the unique
`IDX_trading_card_image_ready_sort_order` index and the
`reorderReadyCardImages` service method both operate on the `READY` set for a
variant. The image at `sort_order = 0` is the primary image — there is no
separate `is_primary` boolean. `PENDING`/`DUPLICATE`/`REJECTED`/`EXPIRED`
images do not occupy a display slot and are excluded from this uniqueness
scope; a `PENDING` image is assigned a real ordering position only once (a
future stage's) confirmation promotes it to `READY`.

Reordering replaces the full `READY` order for a variant in one call — the
caller must submit exactly the current `READY` image IDs for that variant,
each exactly once. The service applies the new order in two phases (a
disjoint high placeholder pass, then the final pass) so a mid-transaction swap
can never collide with the unique active-sort-order index.

## Archive and restore

`archiveCardImage` is idempotent on an already-archived image (returns the
current row without another mutation) and otherwise requires the image to be
`READY`; archiving compacts the remaining `READY` images for that variant back
to a contiguous `0..n-1` order. `restoreCardImage` requires the image to be
`ARCHIVED`, always returns it to `READY`, and appends it at the end of the
variant's current `READY` order. Both mutations lock the owning
`trading_card_variant` row first, so concurrent image mutations on the same
variant serialise instead of racing on sort-order bookkeeping.

Archived images are never included in `listCardImagesForVariant` unless the
caller explicitly asks for `includeArchived: true`.

## R2 configuration

`resolveR2Config` (`apps/backend/src/modules/trading-cards/images/r2-config.ts`)
is disabled unless `R2_IMAGES_ENABLED` is the exact string `"true"` — any
other value, including a typo, keeps local Medusa file behaviour. When
enabled, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`, `R2_S3_ENDPOINT`, and `R2_PUBLIC_BASE_URL` are all required;
the endpoint and public URL must be bare HTTPS origins with no embedded
credentials, and the endpoint's account-ID segment must match
`R2_ACCOUNT_ID`. Cloudflare's default and jurisdiction-specific
(`eu.`/`fips.`) R2 S3 endpoints are both accepted. Every failure message names
only the offending variable, never a secret value.

`medusa-config.ts` calls `resolveR2Config` once at boot. When enabled, it
registers the official `@medusajs/medusa/file-s3` provider (backed by
`@aws-sdk/client-s3`) as the Medusa File Module's provider, with
`region: "auto"`, `acl: false`, and a one-year immutable `cacheControl`. When
disabled, no file-module override is registered at all, so Medusa's default
local file behaviour is unchanged.

## Credential storage

See `docs/operations/environment-variables.md` for the full variable table.
In short:

1. Open the Cloudflare Dashboard → R2 Object Storage → the listing-image
   bucket → "Manage R2 API tokens".
2. Create an "Object Read & Write" token restricted only to that bucket.
3. Save `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` only in
   `apps/backend/.env` (never commit it, never paste the secret into chat).
4. Never place either value in `apps/storefront/.env.local` or behind a
   `NEXT_PUBLIC_` prefix.
5. Production values belong in the future Medusa hosting provider's secret
   environment settings, not Vercel storefront settings.

## Public URL derivation

No `CardImage` row stores a public URL, a presigned URL, or an R2 credential.
`deriveCardImagePublicUrl` (and the underlying `derivePublicImageUrl` helper)
builds `R2_PUBLIC_BASE_URL + encoded object-key path` on demand from a
caller-supplied base URL and object key, encoding each path segment
independently so a stored key can never be reinterpreted as extra path
structure.

## Object keys

`generateStagingObjectKey`/`generateFinalObjectKey`
(`apps/backend/src/modules/trading-cards/images/object-keys.ts`) build keys
only from the owning variant ID, the `CardImage` row ID, and a fresh
`crypto.randomUUID()` — never from the uploaded filename. `createPendingCardImage`
generates and stores a staging key immediately (this is deterministic string
building, not a network call); a sanitised copy of the original filename is
stored separately, only for display, via `sanitiseOriginalFilename`.

## Deferred to a later stage

- Upload confirmation: validating magic bytes, auto-orienting, stripping
  metadata, re-encoding, hashing, and setting `confirmed_mime_type`,
  `confirmed_byte_size`, `width`, `height`, and `sha256_hash`. This is Admin
  Step 3 and is explicitly out of scope for Stage 4B.1.
- Real presigned upload URLs and any other R2 network call.
- Permanent deletion of an archived `CardImage` row — a separately protected
  operation, not part of `archiveCardImage`.
- Resizing, cropping, and marketplace-specific image derivatives.
- Admin image pages, storefront image display, Pulse, inventory, pricing,
  eBay, and Stripe — all untouched by this stage.
