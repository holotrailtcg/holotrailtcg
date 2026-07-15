# TCGdex Admin review API

Stage 4A.4.1 adds authenticated, read-only Medusa Admin routes for reviewing
the real TCGdex enrichment records persisted by Stage 4A.3. The routes use the
existing trading-card module service. They do not alter proposal lifecycle
rules or create any new write path.

## Route contracts

`GET /admin/tcgdex/reviews` returns `{ reviews, count, limit, offset }`.
`limit` defaults to 20 and is bounded from 1 to 100; `offset` defaults to 0.
Optional `status` accepts `PENDING`, `APPROVED`, `REJECTED`, `APPLIED`, or
`SUPERSEDED`. Optional `q` is trimmed and bounded to 100 characters. Search is
case-insensitive across card name, set name, card number, provider card ID and
provider set ID. Each row contains the proposal ID, local card and set
identity, provider IDs, review status, match source, and relevant timestamps.

`GET /admin/tcgdex/reviews/:proposalId` returns `{ review }`, containing:

- the proposal ID and TCGdex provider IDs;
- the local trading card and card set fields needed for comparison;
- the schema-validated, normalised Stage 4A.2 snapshot;
- current review status, match source, reviewer ID, and timestamps; and
- up to 50 relevant lifecycle audit entries, newest first, limited to audit
  ID, actor, action, source, and creation time.

A missing proposal returns `404` with `TCGdex review proposal not found.`

`GET /admin/tcgdex/attempts` returns `{ attempts, count, limit, offset }` with
the same pagination and optional card search rules. Optional `outcome` accepts
`NO_MATCH`, `UNRESOLVED_SET`, `IDENTITY_MISMATCH`,
`INVALID_LOCAL_IDENTITY`, or `PROVIDER_ERROR`. Matched outcomes are never
returned. Each row is limited to the attempt ID, outcome, match source, safe
provider error code, provider IDs when present, timestamps, and linked local
card and set identity.

Unknown parameters, malformed values, and values outside the bounds are
rejected with `400` and simple safe text.

## Authentication and safe fields

All three routes are under `/admin` and use Medusa's normal authenticated
Admin middleware. Unauthenticated requests return `401` before route logic is
run.

Response shaping uses explicit runtime schemas and field allowlists. It never
returns a raw TCGdex response; snapshot or diagnostic fingerprints; audit old
or new values, raw notes, deletion state, database diagnostics, stack traces,
or internal runtime messages. Unknown read failures are returned with the
generic text `The TCGdex review data could not be loaded.`

## Deferred work

Approval, rejection, application, manual matching and trusted-reference
promotion routes remain deferred. This slice contains no Admin UI and no
Pulse, R2, product, stock, inventory, pricing, eBay, Stripe, or storefront
changes.

Stage 4A.4.2 (see
[admin-import-review-shell.md](admin-import-review-shell.md)) builds the
Medusa Admin review pages against these contracts.
