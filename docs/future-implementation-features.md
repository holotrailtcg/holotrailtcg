# Future Implementation Features

This maintained document captures sensible enhancements that are deliberately
outside the current implementation stage. Its purpose is to prevent useful
ideas from being lost while avoiding scope creep in approved work.

## Maintenance rule

Every entry must state why the feature is deferred, its likely dependencies,
the broad implementation direction, and any risks or decisions that still need
confirmation. Listing a feature here does not approve it for implementation.

## Newsletter preference centre

### Goal

Allow confirmed subscribers to choose which categories of email they receive
without unsubscribing from all marketing.

### Potential preference categories

The following are examples only and require business confirmation before they
become final categories:

- Launch updates
- New stock updates
- Promotions and offers
- Japanese card updates
- English card updates
- Chinese card updates
- Category-specific stock alerts

### Proposed data-model direction

Retain one newsletter subscriber identity record and its global lifecycle of
`PENDING`, `CONFIRMED`, or `UNSUBSCRIBED`. Add a separate preference model or
table with one row per subscriber and preference key, rather than adding a
growing collection of boolean columns to the subscriber record. Each preference
would store its enabled status and relevant timestamps, and may also store the
consent version or source where legally or operationally required.

A conceptual preference record could contain:

- `id`
- `subscriberId`
- `preferenceKey`
- `enabled`
- `updatedAt`
- `source`
- Optional consent-version information

This is an architectural direction only. It does not define a migration or
approve a final schema.

### Global unsubscribe rule

`UNSUBSCRIBED` remains the global suppression state and overrides every enabled
individual preference. Re-enabling one preference must never bypass global
unsubscribe. Resubscription requires fresh consent and confirmation under the
final approved policy.

### Future UI direction

Likely future work includes a secure email preference link, a country-aware
preference centre, a global unsubscribe action, per-topic toggles, a save
confirmation, and dedicated privacy and accessibility review.

### Security requirements

- Use an opaque, hashed preference-management token or an authenticated account
  flow.
- Never put an email address in a preference URL.
- Do not rely on browser-only enforcement.
- Enforce global unsubscribe on the server.
- Make updates idempotent and prevent subscriber enumeration.
- Redact management tokens from logs and monitoring.
- Apply rate limiting where appropriate.

### Email-delivery integration

Future campaign or event delivery must verify, in order:

1. The subscriber is `CONFIRMED`.
2. The subscriber is not globally `UNSUBSCRIBED`.
3. The relevant preference is enabled.
4. All applicable consent and suppression rules pass.

### Why deferred

Stage 2C intentionally implements one general newsletter subscription and
double opt-in only. A preference centre is not part of the current launch scope.

### Likely future implementation stage

Plan this as a separate focused stage after Stage 2C is stable, actual email
categories are confirmed, and launch and stock-update email requirements are
defined. Decisions still requiring confirmation include the final category
taxonomy, consent evidence requirements, token lifetime and rotation, and the
interaction between global resubscription and retained preference rows.

## Future feature entry template

### Feature name

- **Goal:** What user or operational outcome should this deliver?
- **Why deferred:** Why is it outside the current approved stage?
- **Likely dependencies:** Which systems, policies, or earlier stages must exist?
- **Broad implementation direction:** What is the likely architecture, without
  prematurely approving code or a schema?
- **Risks and decisions requiring confirmation:** What must be settled before
  implementation begins?
