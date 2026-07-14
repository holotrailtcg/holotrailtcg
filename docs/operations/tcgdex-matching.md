# TCGdex matching boundary

Stage 4A.2 provides a persistence-free boundary between a Holo Trail card
identity and the Stage 4A.1 TCGdex client. Public Stage 4A.2 exports contain
normalized matching types only; raw `TcgDexCard` values remain inside the
provider adapter boundary.

`TcgDexMatchInput` contains the local language, set code, card number, and an
optional descriptive name. Automatic matching requires an explicit trusted
TCGdex set ID, either in `setIdentity.tcgdexSetId` or in a TCGDEX external
reference. A local set code is never guessed as a provider ID. A trusted card
reference uses `getCardById`, requires trusted set identity, validates both the
returned set and local card number, and has manual match source semantics.

Numbers are NFC-normalized and outer-trimmed. Numeric IDs compare without
leading zeroes. Comparison is directional: a local `066/196` may match provider
local ID `066` or `66`, but local `066` does not match provider `066/999`.
When both sides contain denominators, both components must match. Non-numeric
identifiers compare exactly; meaningful text is never stripped.

Empty, whitespace-only, control-character, denominator-only, leading-slash,
trailing-slash, repeated-slash, query, fragment, and internal-whitespace
provider identifiers are rejected before a provider request. Outer whitespace
is trimmed consistently. Valid prefixed, hyphenated, and alphanumeric IDs
remain supported.

Results use `MATCHED`, `NO_MATCH`, `UNRESOLVED_SET`, `IDENTITY_MISMATCH`,
`INVALID_LOCAL_IDENTITY`, and `PROVIDER_ERROR`. Provider errors retain only a
safe Stage 4A.1 error code. Results expose only the provider-independent
normalized enrichment; the raw validated TCGdex card never crosses this
boundary. Normalized variants contain only useful boolean indicators and do not
infer a Holo Trail finish. TCGdex artwork is retained as reference artwork.
Rarity is a candidate: known values are trimmed and compared case-insensitively
against the existing Stage 3 taxonomy map. Unknown values remain explicitly
unmapped while preserving the original validated provider value.

The enrichment policy protects condition, language, finish, special treatment,
SKU, stock, quantity, cost, price, price locks, real listing photographs,
publication state, and manual match decisions. Conflicting trusted set
references are rejected. This stage performs no persistence, audit,
workflow, Medusa, product, variant, inventory, or Admin work.
