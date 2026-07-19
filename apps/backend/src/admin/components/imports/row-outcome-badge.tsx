import { Badge } from "@medusajs/ui"
import BadgeWithTooltip from "./badge-with-tooltip"

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

const OUTCOME_TOOLTIP: Record<string, string> = {
  VALID: "This row parsed cleanly with no issues.",
  VALID_WITH_WARNINGS: "This row is usable, but something was defaulted or unusual (e.g. no condition was stated). See its rows in Diagnostics below for the exact reason.",
  UNRESOLVED_VARIANT: "No existing card/variant could be matched to this row. Resolve it from Inventory proposals, using \"Create card\" if it doesn't exist yet.",
  REVIEW_REQUIRED: "This row needs a decision before it can proceed automatically — for example an unrecognised value or a language/attribute conflict. See its rows in Diagnostics below for the exact reason.",
  INVALID: "This row failed validation and cannot be imported. See its rows in Diagnostics below for the exact reason.",
  SKIPPED: "This row was blank and was skipped.",
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
  const tooltip = OUTCOME_TOOLTIP[outcome]
  const label = OUTCOME_LABEL[outcome] ?? outcome
  const color = OUTCOME_COLOR[outcome] ?? "grey"
  if (!tooltip) {
    return (
      <Badge className="ht-imports-badge" color={color} size="2xsmall">
        {label}
      </Badge>
    )
  }
  return (
    <BadgeWithTooltip color={color} tooltip={tooltip}>
      {label}
    </BadgeWithTooltip>
  )
}

export default RowOutcomeBadge
