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

**The database enforces uniqueness of `READY` sort order per variant; it does
not enforce contiguity.** `IDX_trading_card_image_ready_sort_order` only
prevents two `READY` images from sharing the same position — it does not stop
a gapped sequence such as `0, 2, 3`. Contiguous `0..n-1` ordering is a service
guarantee, not a database one: `reorderReadyCardImages` always replaces the
full `READY` set, `archiveCardImage` compacts the remaining `READY` images
back to `0..n-1`, and `restoreCardImage` appends at the current count. Every
one of these methods calls `lockCardImageVariant` (`select ... for update` on
the owning `trading_card_variant` row) before touching any `CardImage` row for
that variant, so concurrent mutations on the same variant serialise instead of
racing on sort-order bookkeeping. Callers cannot bypass this guarantee because
the generic generated `CardImage` mutation methods
(`createCardImages`/`updateCardImages`/`deleteCardImages`/`softDeleteCardImages`/`restoreCardImages`)
are all blocked with `NOT_ALLOWED` (see "Generic mutations are blocked"
below) — the four domain methods above are the only way to write a
`CardImage` row, so contiguity cannot be broken from outside the service
layer. No database trigger enforces contiguity, and none is planned; it is a
deliberate service-layer guarantee backed by row locking.

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

## Lifecycle and key/metadata constraints (database-enforced)

The `CK_trading_card_image_lifecycle_keys` CHECK constraint on
`trading_card_image` enforces, per `status`, which of
`staging_object_key`/`final_object_key`/`confirmed_mime_type`/`confirmed_byte_size`/
`width`/`height`/`sha256_hash` must be null vs non-null:

- `PENDING`: `staging_object_key` set; `final_object_key` and every confirmed
  metadata field null. No confirmation has happened yet.
- `READY` and `ARCHIVED`: `staging_object_key` null; `final_object_key` and
  every confirmed metadata field set. Both states represent an image that
  completed the (not yet built) confirmation step; `ARCHIVED` retains its
  `READY`-time metadata rather than clearing it, since archiving is always
  reversible back to `READY`.
- `DUPLICATE`, `REJECTED`, `EXPIRED`: terminal non-active outcomes of the
  confirmation step that never reached `READY`, so neither object key nor any
  confirmed metadata field is retained — both are null, by the same rule
  applied uniformly to all three statuses.

`CK_trading_card_image_archived_consistency` (unchanged from the original
Stage 4B.1 migration) separately ties `archived_at`/`archived_by` presence to
`status = 'ARCHIVED'`.

Contiguity of `READY` sort order — "no active ready-order position" gaps — is
not enforced at the CHECK-constraint level. That is unnecessary: the existing
partial unique index `IDX_trading_card_image_ready_sort_order` is scoped to
`status = 'READY'` only, so an `ARCHIVED` row is excluded from it by
construction, and the service layer (see "Ordering and primary image" above)
guarantees contiguity by construction.

## Generic mutations are blocked

`TradingCardsModuleService` blocks every generated bulk mutation method for
`CardImage` — `createCardImages`, `updateCardImages`, `deleteCardImages`,
`softDeleteCardImages`, and `restoreCardImages` — each throwing
`MedusaError.Types.NOT_ALLOWED`. Generated read methods
(`listCardImages`, `retrieveCardImage`, etc.) are untouched. The only
legitimate ways to write a `CardImage` row are the explicit domain methods:
`createPendingCardImage`, `reorderReadyCardImages`, `archiveCardImage`, and
`restoreCardImage` (singular — distinct from the blocked generated
`restoreCardImages`).

## R2 configuration

`resolveR2Config` (`apps/backend/src/modules/trading-cards/images/r2-config.ts`)
is disabled unless `R2_IMAGES_ENABLED` is the exact string `"true"` — any
other value, including a typo, keeps local Medusa file behaviour. When
enabled, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`, `R2_S3_ENDPOINT`, and `R2_PUBLIC_BASE_URL` are all required;
the endpoint and public URL must be bare HTTPS origins with no embedded
credentials, and the endpoint's account-ID segment must match
`R2_ACCOUNT_ID`. Cloudflare's standard, EU (`eu.`), and FedRAMP (`fedramp.`)
R2 S3 endpoints are all accepted; the FIPS (`fips.`) endpoint is explicitly
**not** supported (Cloudflare R2 has no FIPS jurisdiction) and is rejected.
Every failure message names only the offending variable, never a secret
value.

`medusa-config.ts` calls `resolveR2Config` once at boot. When enabled, it
registers the official `@medusajs/medusa/file-s3` provider (backed by
`@aws-sdk/client-s3`) as the Medusa File Module's provider, with
`region: "auto"`, `acl: false`, and a one-year immutable `cacheControl`. When
disabled, no file-module override is registered at all, so Medusa's default
local file behaviour is unchanged.

The real `S3FileService` provider reads its options using exact snake_case
keys (`file_url`, `access_key_id`, `secret_access_key`, `region`, `bucket`,
`endpoint`, `cache_control`, `acl`) — there are no camelCase aliases, so a
camelCase options object is silently ignored rather than rejected.
`buildR2FileProviderOptions` (exported from `r2-config.ts`) is the single
pure function that builds this exact snake_case shape from a resolved
`R2EnabledConfig`; `medusa-config.ts` calls it directly, and it is
unit-tested on its own so a future accidental camelCase regression fails a
fast unit test rather than only failing silently against real R2.

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
