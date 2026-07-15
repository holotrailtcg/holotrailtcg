# TCGdex enrichment persistence and review

Stage 4A.3 stores the Stage 4A.2 normalized `CardEnrichmentData` snapshot in a
dedicated proposal table. The raw provider response never crosses the matching
boundary or enters the database. Non-matched outcomes use a separate,
fingerprint-deduplicated attempt table and retain only schema-validated,
bounded diagnostic data (including the safe provider error code).

Matched proposals have one of `PENDING`, `APPROVED`, `REJECTED`, `APPLIED`, or
`SUPERSEDED`. Only pending proposals can be approved or rejected; only approved
proposals can be applied. Repeating the terminal operation is idempotent.
Rows are locked during recording and review transitions. A repeated normalized
snapshot returns the existing row. A changed snapshot supersedes a pending
proposal. An approved proposal causes a conflict and is never silently
superseded. Snapshot fingerprints use recursively key-sorted canonical JSON;
arrays retain their semantic order. Database uniqueness on the
card/provider/snapshot fingerprint and deduplicated diagnostic fingerprint
protects concurrent workers; expected diagnostic unique races return the
existing row.

Application reparses the stored snapshot and uses an explicit allowlist. In
the current Stage 3 model that allowlist is card name/search name and mapped
rarity. Illustrator, artwork, Pokémon metadata, variants, and unmapped rarity
remain diagnostic snapshot data because no corresponding Stage 3 descriptive
columns exist or the rarity is not mapped. Condition, language, finish,
treatment, SKU, stock, costs, prices, price locks, photographs, publication
state, and manual references are not touched.

Application, automatic references, proposal status and application audit are
one transaction. Reference conflicts or audit failures roll back the complete
application. Trusted manual TCGdex card and set references reuse external references, with
`TRUSTED_MANUAL` provenance. Automatic references are written after successful
application and cannot replace a trusted manual reference. Reference writes and
their manual-reference audits are transactionally atomic, provider-identifier
locked and idempotent. Generic proposal/attempt CRUD mutation methods are
blocked; all writes use explicit domain operations. Audit entries use the existing
append-only system and contain bounded IDs, statuses, provider identifiers and
changed field names only; snapshots and provider payloads are excluded.

Runtime schemas bound actors, provider identifiers, diagnostic values and mapped
rarity values. Database checks enforce diagnostic error-code shape and external
reference ownership; variant-to-card ownership is additionally validated by the
transactional service because it spans two rows. Focused module integration,
concurrency, protected-field, audit-safety and migration up/down/reapply tests
cover these guarantees.

Admin review routes and UI are deferred to Stage 4A.4.
