import { Badge } from "@medusajs/ui"
import type { AttemptOutcome } from "./types"

const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  NO_MATCH: "No match found",
  UNRESOLVED_SET: "Card set not recognised",
  IDENTITY_MISMATCH: "Card details did not match",
  INVALID_LOCAL_IDENTITY: "Card details were incomplete",
  PROVIDER_ERROR: "TCGdex could not be reached",
}

const OUTCOME_COLOR: Record<AttemptOutcome, "grey" | "orange" | "red"> = {
  NO_MATCH: "grey",
  UNRESOLVED_SET: "orange",
  IDENTITY_MISMATCH: "orange",
  INVALID_LOCAL_IDENTITY: "orange",
  PROVIDER_ERROR: "red",
}

interface AttemptOutcomeBadgeProps {
  outcome: AttemptOutcome
}

const AttemptOutcomeBadge = ({ outcome }: AttemptOutcomeBadgeProps) => {
  return (
    <Badge className="ht-imports-badge" color={OUTCOME_COLOR[outcome]} size="2xsmall">
      {OUTCOME_LABEL[outcome]}
    </Badge>
  )
}

export default AttemptOutcomeBadge
