# Stage 5B.1 Slice 3 - Pulse import Admin API and Admin UI

Stage 5B.1 Slice 3 exposes the already-committed Pulse import workflow
(Slice 2, see [ADR 0010](../decisions/0010-pulse-import-workflow.md) and
[the Slice 2 operations guide](stage-5b1-2-pulse-import-workflow.md)) through
authenticated Medusa Admin routes, and builds the "Upload & Import" step of
the Admin import workspace. Routes and UI orchestrate only; every rule about
validation, matching, lifecycle transitions, and reconciliation lives in the
workflow and service layers documented in Slice 2.

## Upload process

`POST /admin/trading-card-inventory/imports/upload` is the only way a Pulse
import begins, and the only way a new inventory source is created for an
import — there is no separate pre-create-source step in this flow.

The request is multipart:

- `file` — the CSV, read into memory by Multer (`multer.memoryStorage()`),
  capped at `PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES` (10 MB). No temp file, no
  filesystem path, no R2 object is ever created.
- Either `inventorySourceId` (Path A — an existing active source) or
  `newSourceDisplayName` together with `newSourceProvider` (Path B — create
  the source as part of this same request), plus optional
  `newSourceLanguage`, `newSourceDefaultCurrencyCode`,
  `previousApprovedSnapshotId`, and `reason`.

The route hands the buffer and fields straight to
`importPulseCsvSnapshotWorkflow` and maps its result:

| Result kind | HTTP status |
|---|---|
| `IMPORTED` | 201 |
| `DUPLICATE` | 200 (not an error) |
| `VALIDATION_FAILED` | 422 |
| `NO_USABLE_ROWS` | 422 |
| `SOURCE_ARCHIVED` | 409 |

Multer's own job is strictly bounded intake and safe error shaping: a
Multer error (oversized file, unexpected field) becomes a clean JSON 400/413
response. It never re-validates CSV extension, MIME type, or content —
`validatePulseFile` inside the workflow remains the sole authority for that.

## Workflow invocation

Routes call the Slice 2 workflow exports directly:

- `importPulseCsvSnapshotWorkflow(container).run({ input })` — upload.
- `retryPulseSnapshotMatchingWorkflow(container).run({ input })` — retry.
- `reconcileInventorySnapshotWorkflow(container).run({ input })` — manual
  reconciliation trigger.

No route re-implements source resolution, file validation, matching,
lifecycle transitions, or reconciliation eligibility.

## Retry

`POST /admin/trading-card-inventory/imports/snapshots/:id/retry-matching`
calls a **dedicated, file-free** `retryPulseSnapshotMatchingWorkflow` with a
narrow input (`{ snapshotId, actor, source, reason?,
previousApprovedSnapshotId? }`) — never the upload workflow with placeholder
file values. This workflow re-runs matching only for entries whose match is
missing or not `MATCHED`. For `PENDING_REVIEW`, it atomically recomputes the
affected Stage 5A.2 groups and updates/removes only still-pending draft
proposals, preserving unaffected proposals. It refuses the retry before any
match write when an affected proposal has been reviewed or otherwise
actioned; terminal snapshot states are also refused. Both retry entry points
call the same shared implementation in `pulse-import-shared.ts`.

The Admin UI shows a "Retry matching" action only when the snapshot summary
reports outstanding `UNMATCHED`/`AMBIGUOUS`/`REVIEW_REQUIRED` rows and the
snapshot is `DRAFT`, `VALIDATED`, or `PENDING_REVIEW`.

## Duplicate handling

Re-uploading the exact same file content against the same source normally
returns `kind: "DUPLICATE"` with the completed live snapshot's identifiers
(HTTP 200, not an error). If the existing snapshot is an interrupted `DRAFT`
or `VALIDATED`, the upload resumes its remaining idempotent phases instead.
Concurrent uploads converge on one snapshot, row set, diagnostic set, and
proposal set. `REJECTED`/`FAILED` snapshots never count as live duplicates.

## Admin UI

- **`/imports/new`** — the Upload & Import screen. Choose an existing active
  source or reveal inline fields to create a new one as part of the same
  submission; choose a CSV file; see the 10 MB limit; submit. The submit
  button is disabled while a file/source hasn't been chosen and again while
  the request is in flight (preventing duplicate submissions). Upload
  progress is tracked via `XMLHttpRequest` (the only way to observe upload
  progress in the browser) and rendered as a simple progress bar. A
  `VALIDATION_FAILED`/`NO_USABLE_ROWS`/`SOURCE_ARCHIVED` result shows a plain
  failure banner with the reason — never raw CSV content, never a stack
  trace. Source language is not asked again for an existing source (the
  source's own configured language is authoritative); a language field only
  appears when creating a new source.
- **`/imports/snapshots/:id`** — the snapshot preview screen. Shows source,
  filename, content hash, status, row/duplicate/unique-reference counts;
  paginated, filterable entry and diagnostics tables (outcome, review
  status, finish, special treatment, rarity, severity); "Retry matching" and
  "Trigger reconciliation" actions, each gated on the snapshot's current
  summary.
- **Workflow shell.** `import-stepper.tsx`'s step 1 ("Upload and import") is
  now marked connected; steps 2-4 continue to link into the existing Stage
  4A/4B screens.

## Validation

Multer bounds request size only. All content validation (extension, MIME
allow-list, UTF-8 decoding, header shape, row/field length caps) happens
inside the workflow's `validatePulseFile`, unchanged from Slice 2. Admin
route bodies/queries are validated with `.strict()` zod schemas
(`imports/shared.ts`) before ever reaching a workflow or service call.

## Limits

- Upload size: `PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES` (10 MB), enforced by
  both Multer (fails fast, before the buffer is fully read) and the
  workflow's own check (defense in depth).
- Row count: `PULSE_FILE_LIMITS.MAX_ROWS` (50,000).
- Field length: `PULSE_FILE_LIMITS.MAX_FIELD_LENGTH` (2,000 characters).
- List/pagination routes (`entries`, `diagnostics`): `limit` bounded to
  1-100, `offset` bounded to 0-1,000,000, enforced by the same zod schemas
  used across the rest of the `trading-card-inventory` Admin API.

## Failure handling

- A thrown `MedusaError` or framework error is mapped to a safe, generic
  message via `safeAdminRead`/`safeAdminWrite` — never a raw stack trace or
  internal error message reaches the client.
- **Workflow-boundary note:** because these routes are the first callers to
  invoke the Slice 2 workflows through their wrapped `.run()` form (every
  existing test called the underlying plain function directly), two
  orchestration-boundary issues were found and fixed as part of this slice —
  a cloned `Buffer` losing its prototype across the step boundary, and a
  thrown `MedusaError` losing its `instanceof` identity the same way. See the
  [ADR 0010 addendum](../decisions/0010-pulse-import-workflow.md#addendum-stage-5b1-slice-3--admin-api-and-admin-ui)
  for the exact mechanism and fix.
- A Pulse provider reference containing whitespace (a real, common case —
  Pulse material tokens like "Reverse Holo" or "Poké Ball" are embedded
  verbatim) is validated by a bounded Pulse-specific schema. Only
  `TRUSTED_MANUAL` references participate in trusted-reference matching.

## Security

- Every route requires standard Medusa Admin authentication
  (`AuthenticatedMedusaRequest`); unauthenticated requests receive 401.
- No raw CSV row or provider payload is ever returned — entry and diagnostic
  DTOs are explicit allow-lists (`toSafeSnapshotEntryDto`,
  `toSafeDiagnosticDto` in `imports/shared.ts`); `raw_fields` is never
  serialized to the client.
- No filesystem path is ever exposed (Multer uses in-memory storage only).
- No stack trace is ever returned to the client.
- Pagination is always bounded (`limit` max 100).
- No route in this slice performs a direct database write outside the
  existing workflow/service methods, mutates stock, approves or rejects a
  proposal, or publishes a product.

## Manual verification

Verified end-to-end against the real backend (via the HTTP integration test
harness, driving the real `POST /admin/trading-card-inventory/imports/upload`
route) using representative rows drawn from
`modules/trading-cards/__fixtures__/pulse-rows.ts` (verified excerpts from
real Pulse exports):

| Case | Result |
|---|---|
| English (holo) | `IMPORTED`, `VALID_WITH_WARNINGS`, reconciled |
| Japanese (holo) | `IMPORTED`, `VALID_WITH_WARNINGS`, reconciled |
| Traditional Chinese (Poké Ball material) | `IMPORTED` — confirmed the whitespace-in-material fix |
| Mid Era (Reverse Holo material) | `IMPORTED` — confirmed the whitespace-in-material fix |
| Duplicate Product IDs within one file (x3) | `IMPORTED`, `duplicateRowCount: 2`, one reconciliation proposal |
| Unknown rarity | `IMPORTED`, `REVIEW_REQUIRED` |
| Blank material | `IMPORTED`, `UNRECOGNIZED_MATERIAL` warning |
| Zero average cost | `IMPORTED` |
| Language conflict (source EN, reference implies JA) | `IMPORTED`, `LANGUAGE_CONFLICT` warning |
| Malformed Product ID | `NO_USABLE_ROWS` (422) |
| Duplicate upload (same bytes, same source) | First: `IMPORTED` (201). Second: `DUPLICATE` (200) |

Browser-driven manual testing of the Admin UI pages was not performed in
this environment (no display server available); the Admin UI was verified
via its component test suite (Testing Library + jsdom) covering the upload
form, progress/duplicate/validation-failure states, and the snapshot detail
page's summary, tables, filters, and retry/reconcile actions.

## Deferred Stage 5B.2 work

Delivered in Stage 5B.2 — see
[ADR 0011](../decisions/0011-inventory-proposal-application-and-medusa-sync.md)
and [the Stage 5B.2 operations guide](stage-5b2-review-approval.md):

- Proposal approval, rejection, and application.
- Holding updates, ledger entries, and real Medusa `InventoryItem`/
  `StockLocation` reflection.

Still out of scope (unchanged): automatic pricing, Pulse market-price
refresh, product creation or publication.

## Known limitations

- The entries table does not expose a literal "Product Name", "Set", or
  "Card Number" column, even though the task brief's column list names them.
  These values only ever exist in each row's `raw_fields` JSON (the raw CSV
  payload), which this slice deliberately never returns to the Admin UI (see
  Security, above — the platform's own rule against provider-payload
  leakage). The entries table instead shows the normalized `providerReference`
  (Pulse's own Product ID string, which already embeds set code, card
  number, material, and condition in a compact, structured form). Splitting
  that reference back into separate display columns client-side would
  duplicate `pulse/product-id.ts`'s parsing logic in a second place; a
  follow-up slice could instead have the backend persist and expose those
  specific fields as additional allow-listed, non-raw columns.
- Local-environment test isolation: this project uses one persistent Neon
  Postgres test database shared by every Jest test type. Inventory module and
  migration suites now run their DDL/data changes inside rollback-only
  transactions, so they restore the exact pre-suite schema and data without
  truncating another suite's rows. A separate, pre-existing, unrelated flake
  in the Stage 4B trading-card image upload HTTP tests was also observed
  during heavy local regression testing and confirmed (via `git stash`) to
  reproduce identically on the pre-Slice-3 commit — out of scope for this
  slice, not caused by any change in it.
