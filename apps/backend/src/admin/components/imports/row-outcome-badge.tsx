import { Badge } from "@medusajs/ui"

const OUTCOME_LABEL: Record<string, string> = {
  VALID: "Valid",
  VALID_WITH_WARNINGS: "Valid, with warnings",
  UNRESOLVED_VARIANT: "Variant not resolved",
  REVIEW_REQUIRED: "Needs review",
  INVALID: "Invalid",
  SKIPPED: "Skipped",
}

const OUTCOME_COLOR: Record<string, "grey" | "orange" | "red" | "green" | "blue"> = {
  VALID: "green",
  VALID_WITH_WARNINGS: "orange",
  UNRESOLVED_VARIANT: "orange",
  REVIEW_REQUIRED: "orange",
  INVALID: "red",
  SKIPPED: "grey",
}

interface RowOutcomeBadgeProps {
  outcome: string | null
}

const RowOutcomeBadge = ({ outcome }: RowOutcomeBadgeProps) => {
  if (!outcome) {
    return (
      <Badge className="ht-imports-badge" color="grey" size="2xsmall">
        —
      </Badge>
    )
  }
  return (
    <Badge className="ht-imports-badge" color={OUTCOME_COLOR[outcome] ?? "grey"} size="2xsmall">
      {OUTCOME_LABEL[outcome] ?? outcome}
    </Badge>
  )
}

export default RowOutcomeBadge
