# ADR 0015: eBay Store category catalogue is local and account-scoped

E2A1 stores seller-owned eBay Store categories in the eBay integration module. They are not Medusa Product Categories and are not marketplace taxonomy categories. External Store IDs are text values and category identity is environment, seller account and external ID.

The local catalogue supports a three-level hierarchy. Every non-root parent in a complete CSV snapshot must also be present in that snapshot. A complete valid CSV import can rename, move or reorder an existing category while retaining its local record, and soft-removes active categories missing from the import. Removed records are retained for history.

Preview records contain only bounded safe metadata: environment, seller account, authenticated actor, SHA-256 CSV digest, active-catalogue fingerprint, summary, expiry and consumption state. They never contain raw CSV. Apply is bound to the exact server-issued preview, actor, CSV bytes and catalogue state; expired, consumed, mismatched or stale previews require a new preview and change nothing. Preview audit metadata may be recorded, but preview never mutates the catalogue. Local subtree removal follows the scoped parent graph and never infers ancestry from display paths or category names.

E2A1 never calls eBay, changes the seller Shop, publishes, lists, exports, or changes stock.

Store-category mutation is domain-owned. Generated Medusa create, update, delete, soft-delete and restore methods for categories and category audits are denied; callers must use the explicit manual create/edit/removal and confirmed import workflows. Store-category audit rows are append-only and can be created only inside those domain transactions.

The safe audit history records authenticated actor, account/environment scope, action, category identity, correlation identity and timestamp. Manual create records the safe resulting category snapshot. Manual edit records safe before/after material fields. Subtree removal records the root, reason, status transition and a bounded deterministic affected-ID list/count. Complete imports record preview identity, CSV SHA-256, exact outcome counts, bounded deterministic outcome IDs, truncation state, and category-level before/after rows for every material change. Preview records a bounded event without mutating the catalogue. Raw CSV, OAuth material, tokens, credentials, provider responses, secrets and stack traces are never stored in category audit details.
