import { model } from "@medusajs/framework/utils"
import TradingCard from "./trading-card"
import { EXTERNAL_PROVIDER } from "../types"

export const TCGDEX_ENRICHMENT_REVIEW_STATUS = {
  PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED", APPLIED: "APPLIED", SUPERSEDED: "SUPERSEDED",
} as const

const TcgDexEnrichmentProposal = model.define({ name: "TcgDexEnrichmentProposal", tableName: "trading_card_tcgdex_enrichment_proposal" }, {
  id: model.id({ prefix: "tcep" }).primaryKey(),
  // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same custom module; Medusa lint resolves this relation incorrectly.
  trading_card: model.belongsTo(() => TradingCard),
  provider: model.enum(Object.values(EXTERNAL_PROVIDER)),
  provider_card_id: model.text(),
  provider_set_id: model.text(),
  match_source: model.enum(["AUTOMATIC", "MANUAL"]),
  snapshot: model.json(),
  snapshot_fingerprint: model.text(),
  review_status: model.enum(Object.values(TCGDEX_ENRICHMENT_REVIEW_STATUS)).default("PENDING"),
  reviewed_at: model.dateTime().nullable(),
  reviewer_id: model.text().nullable(),
  applied_at: model.dateTime().nullable(),
}).indexes([
  { name: "IDX_tcgdex_proposal_card_provider", on: ["trading_card_id", "provider"] },
  { name: "IDX_tcgdex_proposal_snapshot", on: ["trading_card_id", "provider", "snapshot_fingerprint"], unique: true },
])

export default TcgDexEnrichmentProposal
