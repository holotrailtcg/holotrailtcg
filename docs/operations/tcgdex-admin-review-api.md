# TCGdex Admin review API

Stage 4A.4.1 adds authenticated, read-only Medusa Admin routes for reviewing
the real TCGdex enrichment records persisted by Stage 4A.3. The routes use the
existing trading-card module service. They do not alter proposal lifecycle
rules or create any new write path.

Stage 4A.4.3 adds the write actions: approve, reject, apply and retry. See
[Review actions](#review-actions) below.

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

## Review actions

Stage 4A.4.3 adds four authenticated Admin write routes. Every route
requires normal Admin authentication and returns `401` before route logic
runs otherwise. None of them accepts enrichment data from the browser; the
request body is limited to `2kb` and, for reject, to a single bounded
`reason` field.

`POST /admin/tcgdex/reviews/:proposalId/approve` moves a `PENDING` proposal
to `APPROVED` using the existing `approveEnrichmentProposal` service method,
then returns the same `{ review }` shape as the single-review `GET` route.
Approving an already-`APPROVED` proposal is idempotent and returns the
current state unchanged. Any other status returns `400`.

`POST /admin/tcgdex/reviews/:proposalId/reject` moves a `PENDING` proposal
to `REJECTED`. The JSON body may include an optional `reason`: trimmed,
1–300 characters, no control characters. An invalid reason returns `400`
with the same generic `The request parameters are invalid.` text used
elsewhere in this API — no zod internals leak. Rejecting an already-rejected
proposal is idempotent.

`POST /admin/tcgdex/reviews/:proposalId/apply` copies an `APPROVED`
proposal's snapshot onto the trading card using the existing
`applyApprovedEnrichmentProposal` service method (the same explicit field
allowlist and transaction boundary as Stage 4A.3). Applying a proposal that
is not `APPROVED` (and not already `APPLIED`) returns `400`. Applying an
already-`APPLIED` proposal is idempotent. The request body, if any, is never
read by this route — there is no way to influence which fields get applied
from the browser.

`POST /admin/tcgdex/cards/:tradingCardId/retry` re-runs the Stage 4A.2
matcher for a trading card using only identity already held in the
database: the card's `card_number`, its card set's `language` and
`provider_set_code`, and, if present, a `TRUSTED_MANUAL` external reference
for the set or the card itself. No provider ID is ever accepted from the
request. The TCGdex network call happens outside any database transaction;
the result is then persisted through the unchanged Stage 4A.3
`recordTcgdexMatchResult` idempotency rules (repeated identical matches
return the existing proposal; a changed match supersedes the previous
`PENDING` proposal; diagnostic outcomes are deduplicated by fingerprint).
The response is always `{ outcome, review }` for a `MATCHED` result or
`{ outcome, attempt }` for every other match outcome
(`NO_MATCH`, `UNRESOLVED_SET`, `IDENTITY_MISMATCH`, `INVALID_LOCAL_IDENTITY`,
`PROVIDER_ERROR`), shaped through the same safe read-side allowlists as the
`GET` routes — never a raw TCGdex payload, and never the fingerprint or
provider-error message fields. A trading card with no usable local identity
(for example, a blank set code) produces a safe `INVALID_LOCAL_IDENTITY`
diagnostic rather than guessing; the card is unaffected. A misconfigured or
unreachable TCGdex client is reported as
`The TCGdex review action could not be completed.`, with no configuration
or network detail exposed.

Every action records the authenticated Admin user's ID
(`req.auth_context.actor_id`) as the audit actor — never a value from the
request body. Approve, reject and apply are recorded with audit source
`MANUAL` (a person reviewed this); retry's resulting proposal or attempt row
is recorded with source `TCGDEX`, matching every other TCGdex-sourced
enrichment record.

The `TcgDexClient` used by retry has no Medusa module of its own. It is
resolved through a lazy container registration
(`src/api/admin/tcgdex/dependencies.ts`), the same pattern documented for
the newsletter module's reCAPTCHA/Resend adapters
(`docs/decisions/0005-newsletter-backend-design.md`): nothing constructs the
real client until the first real retry request, and HTTP integration tests
register a fake under the same key before any request is made, so the real
TCGdex API is never called by this repository's automated tests.

## Deferred work

Manual matching and trusted-reference promotion routes remain deferred (see
`docs/operations/tcgdex-enrichment-review.md` for the promotion gap). The
Admin UI's "Ignore" action remains unavailable — see
[admin-import-review-shell.md](admin-import-review-shell.md). This slice
contains no Pulse, R2, product, stock, inventory, pricing, eBay, Stripe, or
storefront changes.

Stage 4A.4.2 (see
[admin-import-review-shell.md](admin-import-review-shell.md)) builds the
Medusa Admin review pages against these contracts; Stage 4A.4.3 connects the
review actions documented above to that shell.
