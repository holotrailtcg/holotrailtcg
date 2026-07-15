import { Badge } from "@medusajs/ui"
import type { ReviewStatus } from "./types"

const STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "Waiting for review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  APPLIED: "Applied",
  SUPERSEDED: "Replaced by a newer match",
}

const STATUS_COLOR: Record<ReviewStatus, "grey" | "orange" | "red" | "green" | "blue"> = {
  PENDING: "orange",
  APPROVED: "blue",
  REJECTED: "red",
  APPLIED: "green",
  SUPERSEDED: "grey",
}

interface ReviewStatusBadgeProps {
  status: ReviewStatus
}

const ReviewStatusBadge = ({ status }: ReviewStatusBadgeProps) => {
  return (
    <Badge className="ht-imports-badge" color={STATUS_COLOR[status]} size="2xsmall">
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export default ReviewStatusBadge
