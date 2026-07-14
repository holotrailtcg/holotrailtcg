# TCGdex matching boundary

Stage 4A.2 provides a persistence-free boundary between a Holo Trail card
identity and the Stage 4A.1 TCGdex client.

`TcgDexMatchInput` contains the local language, set code, card number, and an
optional descriptive name. Automatic matching requires an explicit trusted
TCGdex set ID, either in `setIdentity.tcgdexSetId` or in a TCGDEX external
reference. A local set code is never guessed as a provider ID. A trusted card
reference uses `getCardById` and has manual match source semantics.

Numbers are NFC-normalized and outer-trimmed. Numeric IDs compare without
leading zeroes. Comparison is directional: a local `066/196` may match provider
local ID `066` or `66`, but local `066` does not match provider `066/999`.
When both sides contain denominators, both components must match. Non-numeric
identifiers compare exactly; meaningful text is never stripped.

Empty, whitespace-only, control-character, denominator-only, leading-slash,
trailing-slash, and repeated-slash identifiers are rejected before a provider
request. Valid prefixed and hyphenated identifiers remain supported.

Results use `MATCHED`, `NO_MATCH`, `UNRESOLVED_SET`, `IDENTITY_MISMATCH`,
`INVALID_LOCAL_IDENTITY`, and `PROVIDER_ERROR`. Provider errors retain only a
safe Stage 4A.1 error code. Results expose only the provider-independent
normalized enrichment; the raw validated TCGdex card never crosses this
boundary. Normalized variants contain only useful boolean indicators and do not
infer a Holo Trail finish. TCGdex artwork is retained as reference artwork.
Rarity is a
candidate: only exact values represented by the existing Stage 3 taxonomy map;
unknown values remain explicitly unmapped with their validated provider value.

The enrichment policy protects condition, language, finish, special treatment,
SKU, stock, quantity, cost, price, price locks, real listing photographs,
publication state, and manual match decisions. Conflicting trusted set
references are rejected. This stage performs no persistence, audit,
workflow, Medusa, product, variant, inventory, or Admin work.
