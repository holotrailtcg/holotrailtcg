import { Badge } from "@medusajs/ui"
import type { ImageNeedStatus } from "./image-types"

const NEED_STATUS_LABEL: Record<ImageNeedStatus, string> = {
  MISSING: "No images yet",
  PARTIAL: "Some images missing",
  READY: "All variants have images",
}

const NEED_STATUS_COLOR: Record<ImageNeedStatus, "grey" | "orange" | "green"> = {
  MISSING: "orange",
  PARTIAL: "orange",
  READY: "green",
}

interface ImageNeedStatusBadgeProps {
  status: ImageNeedStatus
}

const ImageNeedStatusBadge = ({ status }: ImageNeedStatusBadgeProps) => {
  return (
    <Badge className="ht-imports-badge" color={NEED_STATUS_COLOR[status]} size="2xsmall">
      {NEED_STATUS_LABEL[status]}
    </Badge>
  )
}

export default ImageNeedStatusBadge
