# ADR 0014: eBay E1 connections use attempt-bound OAuth credentials

## Status

Accepted for Stage E1.

## Decision

Holo Trail retains at most one connection row for each of `SANDBOX` and
`PRODUCTION`. Every Connect or Reconnect creates a random UUID attempt. The
connection and its hashed OAuth-state row both record that exact attempt; a
new attempt consumes all unfinished states for the environment. Callback
success and failure updates are conditional on the attempt still being the
connection's current attempt. Actor identity comes only from the consumed
state row, so competing Admins and the two eBay environments cannot
cross-complete.

The exact callback route is deliberately exempt from Medusa Admin-session
authentication. The authenticated start request creates an unguessable,
single-use state, and that state authenticates the returning transaction. Only
its SHA-256 digest is stored. The callback accepts no actor or redirect target,
reveals no connection data, and redirects only to the fixed same-origin eBay
settings result page. Start, status, and disconnect remain Admin-authenticated.

All operations for one environment use the canonical
`ebay-lifecycle:<environment>` PostgreSQL lock namespace: attempt creation,
state consumption and callback finalisation, cached-token validation, refresh
reservation/finalisation, and disconnect. Remote eBay calls occur outside the
lock; code reacquires it and conditionally validates the attempt or credential
generation before persistence. A database refresh-operation reservation also
prevents separate processes from refreshing the same generation concurrently.

Refresh tokens are encrypted with AES-256-GCM before persistence. Ciphertext,
IV, authentication tag, key version, and credential generation are stored in
typed columns with all-or-none constraints. Encryption keys remain backend
secrets. Access tokens are memory-only and each cache entry is tagged with its
environment and credential generation. The lifecycle lock, current status,
generation, and expiry margin are all checked before a cached token is
returned. Reconnect, callback finalisation, disconnect, revocation, and
credential failure invalidate the relevant cache.

eBay's documented refresh response is not treated as rotating the refresh
token. Unknown response fields are ignored after bounded parsing. An
authorisation-code refresh token that cannot be installed is deliberately
discarded without persistence or revocation. RFC 7009 permits revocation to
invalidate related tokens or the underlying grant, and eBay does not document
the isolation needed to prove that a losing-attempt revocation is harmless.
Automated losing-attempt cleanup is prohibited until a supervised Sandbox
experiment demonstrates safe provider semantics for the retained connection.

Statuses distinguish lifecycle meaning: `DEGRADED` retains a usable encrypted
grant after a retryable provider/transport failure; `REFRESH_REQUIRED` means
renewed consent is required; `REVOKED` means remote revocation was confirmed;
`DISCONNECTED` means local access was deliberately removed without confirmed
revocation; and `ERROR` is reserved for unusable local or connection failures.

OAuth-state creation, consumption, and deletion are domain-owned. Opportunistic
cleanup deletes at most 100 expired, superseded, or consumed rows per attempt
start, only after 24 hours, and never deletes the active unexpired current
attempt. Cleanup is deterministically ordered by `(created_at, id)` and runs
on Connect/Reconnect when callback traffic is absent. Audit history is
append-only and retained.

The callback-only middleware removes the query string from `req.originalUrl`
before Medusa's completion-time access logger executes; routing, `req.url`,
params, and parsed query remain unchanged. This prevents OAuth code, state,
and provider error values entering access logs.

### Lifecycle truth table

| Status | Credential material + generation | Current attempt | Refresh reservation |
| --- | --- | --- | --- |
| `CONNECTING` | optional (retained only during reconnect) | required | forbidden |
| `CONNECTED`, `DEGRADED`, `REFRESH_REQUIRED` | required | required | only `CONNECTED`/`DEGRADED` |
| `DISCONNECTING` | optional, retained solely for retry revocation | forbidden | forbidden |
| `REVOKED`, `DISCONNECTED` | forbidden | forbidden | forbidden |
| `ERROR` | optional (for local recovery diagnosis) | optional | forbidden |

The original E1 migration contains named PostgreSQL checks for this table;
the model metadata mirrors them, but the database is authoritative. A
refresh reservation is acquired and expired using PostgreSQL `now()`, never an
application clock. Its owner and credential generation are required for every
finalisation, so stale owners cannot write or cache after takeover. An Admin
may retry `DISCONNECTING`; the retry remains lifecycle-locked, uses the
retained generation only, and always clears local credentials even if remote
revocation fails.

## Consequences

- A refresh that loses to disconnect or reconnect cannot restore status,
  persist rotated material, cache, or return its access token.
- A stale callback cannot replace credentials, identity, actor, cache, or the
  status produced by a newer attempt.
- A token acquired before disconnect may finish an already-running provider
  request, but retrieval after completed disconnect fails closed.
- The configured PostgreSQL locking provider is required for multi-instance
  lifecycle coordination; process memory is only a cache and optimisation.
- Later category, policy, inventory, offer, listing, stock, order, notification,
  marketing, and export stages require separate decisions. E1 grants no
  authority for them.
- Key rotation requires prior key versions to remain in the backend keyring
  until their credentials have been reconnected or rewrapped.
