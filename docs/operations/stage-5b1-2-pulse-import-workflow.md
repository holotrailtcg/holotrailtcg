# Stage 5B.1 Slice 2 - Pulse import workflow

Stage 5B.1 Slice 2 wires the already-committed Pulse CSV parser, matcher, and
persistence primitives into a single retry-safe workflow. See
[ADR 0010](../decisions/0010-pulse-import-workflow.md) for the design
decisions and the two pre-existing bugs this slice found and fixed.

## Bounded-memory intake

- Upload bytes arrive as a single in-memory `Buffer`, capped by
  `PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES` (10 MB) — checked before decoding.
  No temp file, no R2 object, no filesystem path is ever created or exposed.
- SHA-256 is computed over the raw bytes, never the decoded text.
- Text is decoded with strict UTF-8 (`decodeUtf8Strict`), rejecting null
  bytes and undecodable content; an optional leading BOM is trimmed.
- Filename and MIME type are checked against single-source-of-truth constants
  (`PULSE_UPLOAD_FILENAME_SUFFIX`, `PULSE_UPLOAD_MIME_ALLOWLIST` in
  `pulse/types.ts`), shared with the future Admin upload route.
- Row count is capped at `PULSE_FILE_LIMITS.MAX_ROWS` (50,000); each field is
  capped at `PULSE_FILE_LIMITS.MAX_FIELD_LENGTH` (2,000 characters).

## Phase boundaries

Each phase is one bounded service transaction or a pure in-memory
computation — never more than one DB transaction per phase, and no single
transaction spans the whole run:

1. **Resolve inventory source** — read-only for an existing source; a
   transactional create-or-get (advisory-locked on the normalized name) for a
   new one. An archived source short-circuits to `SOURCE_ARCHIVED` before any
   file work happens.
2. **Validate the file** — pure, no DB. Byte-size, filename/MIME, UTF-8
   decode, CSV header validation. Any failure returns `VALIDATION_FAILED`
   before a snapshot row ever exists.
3. **Create or return the draft snapshot** — a workflow-level decision (not a
   service decision): looks up a live snapshot by `(source, content_hash)`
   first; only creates one if nothing was found. A complete live duplicate
   returns `DUPLICATE`; an interrupted `DRAFT` resumes idempotently and an
   interrupted `VALIDATED` snapshot continues through file-free retry.
4. **Parse and persist entries** — pure per-row parsing, then one atomic
   batch insert of immutable entries plus their parse-time diagnostics.
5. **Match entries** — batched (~250 rows per persistence transaction), not
   one transaction per row. A uniquely-proven match may write a new trusted
   external reference.
6. **Transition lifecycle** — `DRAFT → VALIDATED`, or `DRAFT → FAILED` if
   zero rows are usable (anything not `INVALID`/`SKIPPED`).
7. **Reconciliation hand-off** — only when the snapshot reached `VALIDATED`;
   delegates entirely to the existing Stage 5A.2 workflow function.
8. **Summary** — combines the live import summary and (if it ran) the
   reconciliation summary into the final result.

## Source resolution

- `createOrGetInventorySource` returns the existing row instead of throwing
  on a name clash, reusing the same advisory-lock key as
  `createInventorySource`.
- An archived existing source is refused, never auto-restored.
- The permanent source name is never derived from the uploaded filename.
- Source language is configured on the source record, not inferred per-row
  (a per-row provider hint is only ever a consistency check).

## Duplicate semantics

- Exact same bytes uploaded twice against the same source returns the
  existing live snapshot's summary (`DUPLICATE`) — no second snapshot, no
  duplicate entries, diagnostics, matches, or proposals.
- The same bytes against a *different* source is a different
  `(source, content_hash)` key and is correctly accepted as a new import.
- A concurrent duplicate upload is resolved deterministically: an advisory
  lock scoped to `(source, content_hash)` serializes the racers, so the
  unique partial index on `InventorySnapshot` is a backstop that is, in
  practice, never the thing that actually resolves the race.
- A `REJECTED` or `FAILED` snapshot is never treated as a live duplicate — a
  fresh upload of the same bytes after rejection/failure creates a new
  snapshot.

## Lifecycle transitions reachable from this workflow

```
DRAFT → VALIDATED → PENDING_REVIEW   (happy path, reconciliation ran)
DRAFT → FAILED                       (zero usable rows)
```

No other transition (`APPROVED`, `APPLYING`, `APPLIED`, `REJECTED`,
`SUPERSEDED`) is reachable from this workflow — those remain a later
Admin-approval slice's responsibility.

## Retry classification

| Class | Example | Behaviour |
|---|---|---|
| `RETRYABLE` | transient lock/connection contention | Replay the same input unchanged; every phase is idempotent |
| `TERMINAL` | malformed bytes, bad headers, oversized file | Replay with the same bytes always fails the same way |
| `DUPLICATE_SUCCESS` | identical `(source, content_hash)` already imported | Not an error — the `DUPLICATE` result |
| `USER_CORRECTABLE` | archived source, zero usable rows | Operator must change the target source or fix the file |

A retry against an already-partially-imported snapshot
(`retryOfSnapshotId`) skips source/file/snapshot creation, never re-parses or
rewrites a persisted entry, and only re-runs matching for entries whose
match is missing or not `MATCHED`.

`PENDING_REVIEW` is retryable only while every affected proposal remains
`PENDING`. Match writes and affected Stage 5A.2 proposal refreshes share one
transaction and are refused before mutation if an affected proposal has been
reviewed or otherwise actioned. Terminal snapshot states are never retryable.

## Reconciliation hand-off

The existing Stage 5A.2 `reconcileInventorySnapshotWithPriceLocks` function is
reused unmodified. This workflow does not re-implement its eligibility
checks or its own-baseline idempotency guard — it simply calls that function
whenever the snapshot reaches `VALIDATED` and trusts its existing behaviour.

## Immutable entry vs. mutable match-result design

- `InventorySnapshotEntry` (including Stage 5B.1's parse-time columns:
  `row_number`, `outcome`, `condition_source`, `finish_candidate`,
  `special_treatment_candidate`, `rarity_candidate`, `rarity_raw`,
  `language_conflict`, bounded `raw_fields`) is write-once. A retry never
  updates it.
- `InventorySnapshotEntryMatch` is the only mutable, retryable surface —
  create-or-update, with `retry_count`/`last_retried_at` bookkeeping.
- `InventorySnapshotEntryDiagnostic` is append-only in both directions:
  parse-time diagnostics are never revisited, and matching-time diagnostics
  are appended only when their semantic identity is new, so retry cannot
  duplicate an existing diagnostic.

## Trusted-reference policy

Only a uniquely-proven case-3 match (no trusted reference existed, every
commercial attribute was explicit, and exactly one existing variant matches)
may create a new trusted `ExternalCardReference(provider=PULSE)`. No
name-only matching. No card, set, or variant creation from an untrusted row.
No TCGdex-style auto-approval. No protected field is ever overwritten.

## Explicitly out of scope for this slice

- Any Admin HTTP route (upload, summary, entries, diagnostics, retry,
  reconcile) or Admin UI.
- Proposal approval, rejection, or application.
- Any holding update, ledger entry, Medusa `InventoryItem` mutation,
  `StockLocation` mutation, product creation, or product publication.

## Regression coverage

Stage 3, 4A, 4B, 5A.1, 5A.2, 5B.1 parser/matching, newsletter, and
coming-soon suites all pass unchanged; see the full chained
`test:integration:modules` script in `package.json` (now including three
isolated `MedusaApp`-booting specs for `TRADING_CARD_INVENTORY_MODULE`,
mirroring the existing `TRADING_CARDS_MODULE` isolation pattern documented in
`jest.config.js`).
