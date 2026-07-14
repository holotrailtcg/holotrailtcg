# TCGdex matching boundary

Stage 4A.2 provides a persistence-free boundary between a Holo Trail card
identity and the Stage 4A.1 TCGdex client.

`TcgDexMatchInput` contains the local language, set code, card number, and an
optional descriptive name. Automatic matching requires an explicit trusted
TCGdex set ID, either in `setIdentity.tcgdexSetId` or in a TCGDEX external
reference. A local set code is never guessed as a provider ID. A trusted card
reference uses `getCardById` and has manual match source semantics.

Numbers are NFC-normalized and outer-trimmed. Numeric IDs compare without
leading zeroes. Numerator/denominator forms compare by numerator when one side
is a provider local ID, and by both numerator and denominator when both sides
contain denominators. Non-numeric identifiers compare exactly; meaningful text
is never stripped.

Results use `MATCHED`, `NO_MATCH`, `UNRESOLVED_SET`, `IDENTITY_MISMATCH`,
`INVALID_LOCAL_IDENTITY`, and `PROVIDER_ERROR`. Provider errors retain only a
safe Stage 4A.1 error code. Normalization produces a provider-independent
descriptive DTO and retains TCGdex artwork as reference artwork. Rarity is a
candidate: only exact values represented by the existing Stage 3 taxonomy map;
unknown values remain explicitly unmapped with their validated provider value.

The enrichment policy protects condition, language, finish, special treatment,
SKU, stock, cost, price, price locks, real listing photographs, publication
state, and manual match decisions. This stage performs no persistence, audit,
workflow, Medusa, product, variant, inventory, or Admin work.
