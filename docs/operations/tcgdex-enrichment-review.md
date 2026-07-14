# TCGdex enrichment persistence and review

Stage 4A.3 stores the Stage 4A.2 normalized `CardEnrichmentData` snapshot in a
dedicated proposal table. The raw provider response never crosses the matching
boundary or enters the database. Non-matched outcomes use a separate,
fingerprint-deduplicated attempt table and retain only bounded diagnostic data
(including the safe provider error code).

Matched proposals have one of `PENDING`, `APPROVED`, `REJECTED`, `APPLIED`, or
`SUPERSEDED`. Only pending proposals can be approved or rejected; only approved
proposals can be applied. Repeating the terminal operation is idempotent.
Rows are locked during recording and review transitions. A repeated normalized
snapshot returns the existing row. A changed snapshot supersedes a pending
proposal. An approved proposal causes a conflict and is never silently
superseded. Database uniqueness on the card/provider/snapshot fingerprint and
deduplicated diagnostic fingerprint protects concurrent workers.

Application reparses the stored snapshot and uses an explicit allowlist. In
the current Stage 3 model that allowlist is card name/search name and mapped
rarity. Illustrator, artwork, Pokémon metadata, variants, and unmapped rarity
remain diagnostic snapshot data because no corresponding Stage 3 descriptive
columns exist or the rarity is not mapped. Condition, language, finish,
treatment, SKU, stock, costs, prices, price locks, photographs, publication
state, and manual references are not touched.

Trusted manual TCGdex card and set references reuse external references, with
`TRUSTED_MANUAL` provenance. Automatic references are written after successful
application and cannot replace a trusted manual reference. Reference writes are
provider-identifier locked and idempotent. Audit entries use the existing
append-only system and contain bounded IDs, statuses, provider identifiers and
changed field names only; snapshots and provider payloads are excluded.

Admin review routes and UI are deferred to Stage 4A.4.
