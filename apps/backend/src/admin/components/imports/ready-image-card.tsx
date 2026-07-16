import { Badge, Button, Container, Text } from "@medusajs/ui"
import { useState } from "react"
import FocalPositionSelector, { type FocalPosition } from "./focal-position-selector"
import { isPrimary, visibleImageActions } from "./image-actions"
import ImageStatusBadge from "./image-status-badge"
import type { CardImageDto } from "./image-types"

interface ReadyImageCardProps {
  image: CardImageDto
  position: number
  readyCount: number
  onMoveEarlier: () => void
  onMoveLater: () => void
  onMakePrimary: () => void
  onArchive: () => void
  onFocalChange: (position: FocalPosition) => void
}

const ReadyImageCard = ({
  image, position, readyCount, onMoveEarlier, onMoveLater, onMakePrimary, onArchive, onFocalChange,
}: ReadyImageCardProps) => {
  const [showFocal, setShowFocal] = useState(false)
  const actions = visibleImageActions(image, position, readyCount)
  const primary = isPrimary(image)

  return (
    <Container className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <ImageStatusBadge status={image.status} />
        {primary && (
          <Badge className="ht-imports-badge" color="blue" size="2xsmall">
            Primary
          </Badge>
        )}
      </div>
      {image.imageUrl && (
        <img src={image.imageUrl} alt={image.originalFilename} className="max-h-48 w-auto border" />
      )}
      <Text size="xsmall" className="text-ui-fg-subtle">
        {image.originalFilename}
      </Text>
      <div className="flex flex-wrap gap-2">
        {actions.moveEarlier && (
          <Button size="small" variant="secondary" onClick={onMoveEarlier}>
            Move earlier
          </Button>
        )}
        {actions.moveLater && (
          <Button size="small" variant="secondary" onClick={onMoveLater}>
            Move later
          </Button>
        )}
        {actions.makePrimary && (
          <Button size="small" variant="secondary" onClick={onMakePrimary}>
            Make primary
          </Button>
        )}
        {actions.changeFocalPoint && (
          <Button size="small" variant="secondary" onClick={() => setShowFocal((value) => !value)}>
            Focal position
          </Button>
        )}
        {actions.archive && (
          <Button size="small" variant="danger" onClick={onArchive}>
            Archive
          </Button>
        )}
      </div>
      {showFocal && actions.changeFocalPoint && (
        <FocalPositionSelector value={{ x: image.focalX, y: image.focalY }} onChange={onFocalChange} />
      )}
    </Container>
  )
}

export default ReadyImageCard
