import { Badge } from "@medusajs/ui"

const STATUS_LABEL: Record<string, string> = {
  UNMATCHED: "Not matched",
  MATCHED: "Matched",
  AMBIGUOUS: "Ambiguous",
  REVIEW_REQUIRED: "Needs review",
}

const STATUS_COLOR: Record<string, "grey" | "orange" | "red" | "green" | "blue"> = {
  UNMATCHED: "grey",
  MATCHED: "green",
  AMBIGUOUS: "orange",
  REVIEW_REQUIRED: "orange",
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
