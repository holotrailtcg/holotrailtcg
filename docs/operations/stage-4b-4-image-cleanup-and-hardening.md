# Stage 4B.4 — card-image cleanup and hardening

Stage 4B.4 adds two scheduled background jobs on top of the `CardImage`
domain, R2 storage client, and managed-prefix guards Stages 4B.1-4B.3
built:

- **Slice 1 — hourly expired-upload sweep** (`card-image-expiry-sweep`):
  transitions abandoned `PENDING` uploads to `EXPIRED`. A row-status
  transition only; it never touches R2.
- **Slice 2 — daily orphaned R2 object reconciliation**
  (`card-image-orphan-reconciliation`): deletes R2 objects under the two
  managed prefixes that are no longer referenced by any live `CardImage`
  row. This is the first job in this stage that deletes storage.

Neither job adds Pulse, storefront image display, inventory, pricing,
eBay, Stripe, an Admin cleanup UI, permanent `CardImage` row deletion, image
derivatives, or thumbnails.

## Safety guarantee

> The reconciliation job only deletes objects that are both older than the
> grace period and unreferenced at the moment of deletion. Referenced
> `READY` and `ARCHIVED` images are never deleted automatically.

Archived images, and the final objects they reference, are never purged by
this or any other automated job. Permanent deletion of a `CardImage` row
remains explicitly deferred to a future, separately approved stage.

## Managed prefixes

Both jobs, and every R2 list/head/delete call in this codebase, are bounded
to exactly two prefixes (`src/modules/trading-cards/images/managed-prefixes.ts`):

- `staging/card-images/` — unconfirmed uploads.
- `card-images/` — confirmed, ready/archived images.

`assertManagedPrefix`/`assertManagedKey` enforce this before any call
reaches the real AWS SDK client or a fake test double — a caller-supplied
or malformed prefix is rejected, never silently widened.

## Slice 1 — hourly expiry sweep

`src/jobs/card-image-expiry-sweep.ts`, cron `0 * * * *`. Calls
`TradingCardsModuleService.expirePendingCardImages(cutoff, batchSize)` in a
`do…while` loop until a batch comes back smaller than the 500-row batch
size, transitioning every `PENDING` row whose `upload_expires_at` has
passed to `EXPIRED` (nulling its `staging_object_key`) — the same
transition `confirmPendingCardImage` already performs lazily. Uses
`for update skip locked` so two overlapping sweeps never race the same row
(proven in `trading-card-image-expiry-sweep.spec.ts`). This transition is
never gated by dry-run and never touches R2 — a status flip is not a
destructive action.

## Slice 2 — daily orphan reconciliation

`src/jobs/card-image-orphan-reconciliation.ts`, cron `0 3 * * *` (daily at
03:00). A no-op wherever R2 is not configured
(`R2_IMAGES_ENABLED` not exactly `"true"`) or `DATABASE_URL` is unset.
Runs once for `staging/card-images/` and once for `card-images/`,
sequentially, each in its own `try/catch` — a failure on one prefix never
stops the other.

### What "orphaned" means

An R2 object under a managed prefix is a deletion candidate only if **all**
of the following hold:

1. It is older than the 30-minute grace period
   (`CARD_IMAGE_ORPHAN_GRACE_PERIOD_MINUTES`) — an object may simply be
   mid-upload, so anything younger is always retained regardless of
   reference state.
2. No live (`deleted_at is null`) `CardImage` row's `staging_object_key` or
   `final_object_key` equals its key. The `CK_trading_card_image_lifecycle_keys`
   check constraint on `trading_card_image` already guarantees only
   `PENDING` rows carry a staging key and only `READY`/`ARCHIVED` rows carry
   a final key — every other status has both null — so "referenced" is a
   single existence query, not per-status branching.
3. It is still unreferenced on a **second**, independent check performed
   immediately before deletion. This closes the race where a new upload
   claims the exact key between the initial scan and the delete call — it
   is not an optional optimization and is never collapsed into one check.

`headObject` is never called during reconciliation — `listObjects`'s
returned `lastModified`/`size` per entry are already everything the
grace-period check needs.

### Dry-run

`CARD_IMAGE_CLEANUP_DRY_RUN` (`src/modules/trading-cards/images/cleanup-config.ts`):

| Value | Behaviour |
| --- | --- |
| Unset, empty, or any malformed value (`"TRUE"`, `"1"`, whitespace, ...) | Dry-run **on** (default) — candidates are counted (`wouldDelete`) but never deleted. |
| Exact, case-sensitive string `"false"` | Dry-run **off** — matching candidates are actually deleted. |

Dry-run only governs R2 orphan deletion. The hourly expiry sweep (Slice 1)
is unaffected and always runs for real.

### Bounded, paginated scans

Each prefix inspects at most `CARD_IMAGE_ORPHAN_MAX_OBJECTS_PER_RUN`
(5,000) objects per run, paging through `listObjects` (1,000 objects per
page by default). If a backlog exceeds the bound, the run stops with
`limitReached: true` in its counts and the remainder is picked up by the
next night's scheduled run — there is no same-run drain-until-empty loop
like the expiry sweep's.

### Advisory locking

Overlapping runs for the same prefix are prevented by a genuine
PostgreSQL **session**-level advisory lock (`pg_try_advisory_lock`/
`pg_advisory_unlock`, not the transaction-scoped `_xact_lock` variant used
elsewhere in this module), implemented in
`src/modules/trading-cards/images/orphan-reconciliation-lock.ts`:

- Uses the two-int form of the lock functions: a fixed namespace constant
  (`CARD_IMAGE_ORPHAN_LOCK_NAMESPACE`) plus an explicit per-prefix key
  (`0` for staging, `1` for final) — deterministic and stable across
  PostgreSQL versions, with no dependency on hashing an arbitrary string.
- Staging and final prefixes use independent keys, so they always run
  independently — one prefix's run never blocks the other.
- The attempt is non-blocking (`pg_try_advisory_lock`, never
  `pg_advisory_lock`): a second concurrent run for the same prefix returns
  immediately with all-zero counts rather than waiting. That is a normal,
  expected "already running, skip this tick" outcome, not an error.
- The lock is always released in a `finally` block, so a thrown error
  mid-run (an R2 failure, a database error, anything) still frees the lock
  for the next scheduled attempt.

**Why a dedicated `pg.Client`, wrapped in an explicit transaction, rather
than the pooled MikroORM/Knex connection:** a session-level lock only means
what it says if the acquire, hold, and release calls all happen on the
exact same physical connection — a lock acquired on one pooled connection
and "released" from a different one is a silent no-op that leaks the lock
until that connection is evicted. This project's `DATABASE_URL` can point
at a PgBouncer-style connection pooler in transaction-pooling mode (this is
true of Neon's pooled endpoint, which is what this project's own test
database uses) — verified directly against it that such a pooler resets
session state, including session-level advisory locks, between separate
autocommitted statements, even on what looks like one stable `pg.Client`
connection. The fix, also verified against the real test database: wrap
the acquire → hold → release sequence in one explicit `BEGIN`/`COMMIT` on
the dedicated client — this is what actually pins the pooler's backend
connection for the run's whole duration. That transaction takes **zero row
locks and performs zero writes** — only the advisory-lock calls themselves,
plus (on the separate, ordinary pooled connection) the read-only
reference-check selects described above — so it never blocks or is blocked
by other application traffic. It exists purely to defeat pooler backend
reassignment, not for row-level isolation, and is a deliberate, narrow
exception to "no long transaction around R2 calls": it holds one pooled
connection open for the run's bounded duration (≤5,000 objects/prefix),
an accepted trade-off for a once-daily job.

### Failure and retry behaviour

- `listObjects` fails: that prefix's run stops immediately and logs a safe
  aggregate failure line; the other prefix still runs.
- `deleteObject` fails for one object: `errors` is incremented, the loop
  continues to the next object, and the failed object is left in R2 to be
  retried automatically on the next scheduled run. No database retry
  counter or cleanup marker column exists or is needed.
- An object disappears between listing and deletion: `deleteObject` is
  documented idempotent (an already-missing key is a silent success), so
  this counts as a successful deletion and the loop continues.
- An object becomes referenced between the initial scan and the pre-delete
  recheck: the second check retains it — see "What 'orphaned' means" above.

### Logging

Both jobs log exactly one aggregate line per run/prefix — `scanned`,
`retained`, `wouldDelete`, `deleted`, `errors`, `pagesProcessed`,
`limitReached`, and the effective `dryRun` value. Neither job, nor the
service method or lock adapter underneath it, ever logs an object key,
image id, variant id, filename, URL, or credential (including the database
connection string, which the lock adapter only ever passes to `pg.Client`,
never to `console.log`).

## Enabling real deletion

`CARD_IMAGE_CLEANUP_DRY_RUN` belongs only in `apps/backend/.env` (and its
committed blank/default placeholder in `apps/backend/.env.template` and the
root `.env.example`), never in a storefront environment file, and never as
`NEXT_PUBLIC_`:

- Leave it unset, or set it to `CARD_IMAGE_CLEANUP_DRY_RUN=true`, for
  dry-run (the safe default).
- Set `CARD_IMAGE_CLEANUP_DRY_RUN=false` (the exact string) to enable real
  deletion.

## Manual verification (non-production R2 only)

Never use production R2 or production credentials for this. Against a
non-production bucket configured via `R2_*` in `apps/backend/.env`:

1. Leave `CARD_IMAGE_CLEANUP_DRY_RUN` unset or `true`.
2. Add one object older than 30 minutes directly under
   `staging/card-images/` in that bucket, using a key nothing in your local
   `trading_card_image` table references.
3. Run the reconciliation job manually (e.g. via `medusa exec` against a
   small script that calls the job's default export, or by temporarily
   triggering Medusa's scheduled-job runner).
4. Confirm the object is still present in the bucket, and the job's log
   line shows it counted under `wouldDelete`, not `deleted`.
5. Set `CARD_IMAGE_CLEANUP_DRY_RUN=false`.
6. Run the job again.
7. Confirm the object is now deleted from the bucket, and the log line
   shows `deleted` incremented instead.
8. Confirm any `READY` or `ARCHIVED` image's real final object in the same
   bucket is still present and unaffected throughout.

No automated test requires real R2 credentials — every test in this stage
runs against `FakeR2ImageStorageClient` (an in-memory double) or, for the
advisory lock itself, this project's real (non-production) test database.
