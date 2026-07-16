import { Badge } from "@medusajs/ui"
import type { CardImageStatus } from "./image-types"

const STATUS_LABEL: Record<CardImageStatus, string> = {
  PENDING: "Uploading",
  READY: "Ready",
  DUPLICATE: "Duplicate",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  ARCHIVED: "Archived",
}

const STATUS_COLOR: Record<CardImageStatus, "grey" | "orange" | "red" | "green" | "blue"> = {
  PENDING: "orange",
  READY: "green",
  DUPLICATE: "grey",
  REJECTED: "red",
  EXPIRED: "grey",
  ARCHIVED: "grey",
}

interface ImageStatusBadgeProps {
  status: CardImageStatus
}

const ImageStatusBadge = ({ status }: ImageStatusBadgeProps) => {
  return (
    <Badge className="ht-imports-badge" color={STATUS_COLOR[status]} size="2xsmall">
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export default ImageStatusBadge
