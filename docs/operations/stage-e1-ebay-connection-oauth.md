# Stage E1 eBay connection operations

## Scope and safety boundary

E1 only connects, identifies, refreshes, and disconnects an eBay account. It
does not implement categories, policies, taxonomy, listings, publication,
stock synchronisation, orders, notifications, marketing, or CSV export.
`EBAY_CONNECTIONS_ENABLED` defaults to `false`.

## eBay developer setup

Create separate Sandbox and Production keysets. For each keyset, configure both
the **Accepted** and **Declined** RuName browser URLs to return to that
environment's exact endpoint:

- Sandbox: `<backend-origin>/admin/ebay/connections/callback/SANDBOX`
- Production: `<backend-origin>/admin/ebay/connections/callback/PRODUCTION`

Put the keyset's RuName—not the browser URL—in the matching
`EBAY_*_REDIRECT_URI`. The callback does not depend on an Admin cookie: the
authenticated start request creates a hashed-at-rest, attempt-bound, single-use
state that authenticates the return. It always redirects to the fixed Admin
eBay settings page. All other eBay Admin endpoints still require Admin
authentication, and mutations require an allowed `Origin` via `ADMIN_CORS`.
After a valid state-bound denial, the fixed redirect contains only
`result=denied` and Admin displays that authorisation was cancelled; provider
error text and denial parameters are never reflected.

Store client IDs, client secrets, and token-encryption material only on the
backend. Generate a dedicated encryption key as 32 cryptographically random
bytes encoded as canonical base64. Set an explicit bounded label such as `v1`
in `EBAY_TOKEN_ENCRYPTION_KEY_VERSION`; there is no runtime default. Retained
key entries must use different versions from the active key.

Before Production use, complete eBay's Marketplace Account Deletion compliance
setup. The Production application must have the required account-deletion
notification subscription and endpoint, or an approved eBay exemption. E1 does
not implement that notification endpoint; this is a Production prerequisite.

Run the E1 migration before enabling `EBAY_CONNECTIONS_ENABLED=true`.

For the current supervised local Sandbox verification, the operator-confirmed
development target is the Neon database named `holotrail_medusa_test`, reached
through its pooled endpoint. The name is historical and does not make this a
Production target. Treat this database as the local development target during
the live E1 smoke test, do not run automated test suites concurrently, and
continue to verify the effective database name before applying migrations.
Production remains a separate target and must not be used for this procedure.

## Lifecycle and recovery

Every Connect/Reconnect starts a new random attempt and supersedes unfinished
attempts for that environment. Sandbox and Production use separate rows and
locks. Callback finalisation, refresh, cache validation, reconnect, and
disconnect coordinate through `ebay-lifecycle:<environment>`. Access-token
cache entries are memory-only and credential-generation-aware.

Status meanings:

| Status | Operator meaning |
| --- | --- |
| `CONNECTING` | A current attempt is awaiting its callback; a reconnect may retain the old encrypted grant until the result is known |
| `CONNECTED` | Grant is installed and usable |
| `DEGRADED` | Encrypted grant is retained; a temporary operation failed and automatic retry remains possible |
| `REFRESH_REQUIRED` | Grant is invalid or expired; reconnect and renewed consent are required |
| `DISCONNECTING` | Local token use is blocked while an administrator may retry the remote/local disconnect sequence |
| `REVOKED` | Deliberate disconnect with confirmed remote revocation |
| `DISCONNECTED` | Local credential removed; remote revocation was not confirmed |
| `ERROR` | No usable local connection was installed or credential processing failed |

If failure occurs after eBay issues a new refresh token but before installation,
the backend discards it without persistence or automatic revocation. RFC 7009
allows revocation to invalidate related tokens or the authorisation grant, and
eBay does not document enough isolation to risk the retained connection.
Automated losing-attempt cleanup may be considered only after a supervised
Sandbox experiment proves it cannot invalidate a retained connection. No
credential value is logged, returned, audited, or retained on this path.

The callback route strips its query string from the access-log-visible request
URL before route processing. State, code, provider errors, and arbitrary query
values remain available only to validation and never enter access logs.

`DISCONNECTING` is an intentionally visible recovery state. An administrator
may select **Retry disconnect** (including the normal Production confirmation)
after an interruption. The retry is idempotent, is lifecycle-locked, uses only
the retained credential generation, blocks token retrieval, and completes
local credential removal even when eBay revocation fails.

Refresh reservations use PostgreSQL time and can be taken over only after the
database timeout. A previous owner cannot finalise after a takeover, reconnect,
or disconnect because generation and reservation ownership are conditional.

For key rotation, deploy a new explicit active version/key and retain old
version-to-key entries in `EBAY_TOKEN_ENCRYPTION_KEYS_JSON`. Reconnect or rewrap
all old credentials before removing a retained version. If a key is lost, the
credential is intentionally unrecoverable: revoke where possible, remove local
access, and reconnect.

OAuth states are retained for audit/race tolerance and cleaned opportunistically
in bounded batches of at most 100. Expired, consumed, and superseded states are
eligible after 24 hours. The active unexpired current attempt is protected.

## Safe verification

Automated tests use fake eBay adapters and a test PostgreSQL database. They do
not contact eBay. Verify that:

1. Sandbox connection changes only the Sandbox card.
2. Production connection requires its explicit warning and confirmation.
3. A valid callback completes without an Admin cookie; replay, invented,
   expired, and superseded states fail with only a generic fixed redirect.
4. A stale callback cannot change a newer account, status, actor, credential,
   or cache generation.
5. Disconnect yields `REVOKED`, or `DISCONNECTED` with the safe
   `REVOCATION_UNCONFIRMED` category when remote revocation was not confirmed.
6. Responses, redirects, audit rows, and logs contain no OAuth code/state,
   access or refresh token, client secret, ciphertext, IV, or authentication
   tag.

The following require a separately authorised, supervised live Sandbox smoke
test and remain **NOT TESTED** by E1 automation:

- actual Sandbox Accepted redirect;
- actual Sandbox Declined redirect and its exact denial parameters;
- real token refresh;
- real token revocation.

Do not infer or hard-code an undocumented Declined query shape. The parser
accepts the documented OAuth error form while still requiring valid state.
