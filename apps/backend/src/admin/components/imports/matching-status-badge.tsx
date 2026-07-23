import { Badge } from "@medusajs/ui"

const STATUS_LABEL: Record<string, string> = {
  UNMATCHED: "Not matched",
  MATCHED: "Match found",
  // Pulse's own local-matching ambiguity (e.g. two local variants equally
  // match a row's condition/finish) — a different concept from a TCGdex
  // lookup candidate's own ambiguity below; kept as its own label so the two
  // are never conflated.
  AMBIGUOUS: "Ambiguous",
  REVIEW_REQUIRED: "Needs review",
  // Synthetic key (never a real `matching_status` value) — set by the
  // caller when a TCGdex lookup candidate's own `matchOutcome` is
  // `AMBIGUOUS`: the exact lookup found nothing, but a fallback set-scoped
  // search found 1+ plausible cards. A reviewer must pick the right one (or
  // none) via "View matches"; never auto-applied.
  TCGDEX_AMBIGUOUS: "Awaiting review",
  // Synthetic key: set by the caller once the row's candidate has actually
  // been accepted and resolved to a real trading-card variant
  // (`row.tradingCardVariantId` is set) — distinct from plain `MATCHED`,
  // which only means a TCGdex candidate exists and is still awaiting
  // approval. Without this, both states showed the same "Match found" label.
  CARD_MATCHED: "Card Matched",
}

const STATUS_COLOR: Record<string, "grey" | "orange" | "red" | "green" | "blue"> = {
  UNMATCHED: "grey",
  MATCHED: "green",
  AMBIGUOUS: "orange",
  REVIEW_REQUIRED: "orange",
  TCGDEX_AMBIGUOUS: "orange",
  CARD_MATCHED: "blue",
}

interface MatchingStatusBadgeProps {
  status: string | null
}

const MatchingStatusBadge = ({ status }: MatchingStatusBadgeProps) => {
  if (!status) {
    return (
      <Badge className="ht-imports-badge" color="grey" size="2xsmall">
        —
      </Badge>
    )
  }
  return (
    <Badge className="ht-imports-badge" color={STATUS_COLOR[status] ?? "grey"} size="2xsmall">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

export default MatchingStatusBadge
