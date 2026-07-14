import { model } from "@medusajs/framework/utils"
import TradingCard from "./trading-card"
import { EXTERNAL_PROVIDER } from "../types"

const TcgDexEnrichmentAttempt = model.define({ name: "TcgDexEnrichmentAttempt", tableName: "trading_card_tcgdex_enrichment_attempt" }, {
  id: model.id({ prefix: "tcea" }).primaryKey(),
  // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same custom module; Medusa lint resolves this relation incorrectly.
  trading_card: model.belongsTo(() => TradingCard),
  provider: model.enum(Object.values(EXTERNAL_PROVIDER)),
  match_source: model.enum(["AUTOMATIC", "MANUAL"]),
  match_outcome: model.enum(["MATCHED", "NO_MATCH", "UNRESOLVED_SET", "IDENTITY_MISMATCH", "INVALID_LOCAL_IDENTITY", "PROVIDER_ERROR"]),
  provider_card_id: model.text().nullable(),
  provider_set_id: model.text().nullable(),
  safe_provider_error_code: model.text().nullable(),
  diagnostic_fingerprint: model.text(),
}).indexes([
  { name: "IDX_tcgdex_attempt_card_provider", on: ["trading_card_id", "provider"] },
  { name: "IDX_tcgdex_attempt_diagnostic", on: ["trading_card_id", "provider", "diagnostic_fingerprint"], unique: true },
])

export default TcgDexEnrichmentAttempt
