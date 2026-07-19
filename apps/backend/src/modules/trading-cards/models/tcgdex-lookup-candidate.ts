import { model } from "@medusajs/framework/utils"
import { CARD_LANGUAGE, EXTERNAL_PROVIDER } from "../types"

/**
 * Cached result of an automatic, pre-creation TCGdex lookup for one exact
 * card identity (tcgdex_set_id + card_number) — reusable across every
 * snapshot/import that ever references this same physical card, so the
 * live TCGdex call only ever has to happen once per card, forever. Exists
 * independently of `TradingCard`, unlike `TcgDexEnrichmentProposal` (which
 * requires one): a lookup candidate is what lets a card be *created* in the
 * first place, so nothing here can depend on the card already existing.
 *
 * `review_status` only matters when `match_outcome` is `MATCHED` — a human
 * still has to accept it before any card is created from it. Everything
 * else (`NO_MATCH`, `UNRESOLVED_SET`, `IDENTITY_MISMATCH`) is cached purely
 * so the same dead-end lookup is never repeated, and has nothing to accept.
 * `PROVIDER_ERROR` is deliberately never cached here (see the workflow that
 * writes this table) — a transient failure must be retried, not remembered
 * as if it were a stable outcome.
 */
const TcgDexLookupCandidate = model
  .define({ name: "TcgDexLookupCandidate", tableName: "trading_card_tcgdex_lookup_candidate" }, {
    id: model.id({ prefix: "tclookup" }).primaryKey(),
    provider: model.enum(Object.values(EXTERNAL_PROVIDER)),
    language: model.enum(Object.values(CARD_LANGUAGE)),
    tcgdex_set_id: model.text(),
    card_number: model.text(),
    match_outcome: model.enum(["MATCHED", "NO_MATCH", "UNRESOLVED_SET", "IDENTITY_MISMATCH"]),
    // The full `CardEnrichmentData` snapshot when `match_outcome` is
    // `MATCHED` — null for every other outcome, which has nothing to store.
    enrichment: model.json().nullable(),
    review_status: model.enum(["PENDING", "ACCEPTED", "REJECTED"]).nullable(),
  })
  .indexes([
    {
      name: "IDX_trading_card_tcgdex_lookup_candidate_identity",
      on: ["provider", "language", "tcgdex_set_id", "card_number"],
      unique: true,
    },
  ])
  .checks([{
    name: "CK_tcgdex_lookup_candidate_review_status_pair",
    expression: (columns) =>
      `(${columns.match_outcome} = 'MATCHED' and ${columns.review_status} is not null and ${columns.enrichment} is not null) or ` +
      `(${columns.match_outcome} <> 'MATCHED' and ${columns.review_status} is null and ${columns.enrichment} is null)`,
  }])

export default TcgDexLookupCandidate
