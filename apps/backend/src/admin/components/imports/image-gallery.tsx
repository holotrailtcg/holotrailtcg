import { Button, Container, Text } from "@medusajs/ui"
import type { FocalPosition } from "./focal-position-selector"
import ReadyImageCard from "./ready-image-card"
import type { VariantImageGroup } from "./image-types"

interface ImageGalleryProps {
  variant: VariantImageGroup
  onMoveEarlier: (imageId: string) => void
  onMoveLater: (imageId: string) => void
  onMakePrimary: (imageId: string) => void
  onArchive: (imageId: string) => void
  onRestore: (imageId: string) => void
  onFocalChange: (imageId: string, position: FocalPosition) => void
}

const ImageGallery = ({
  variant, onMoveEarlier, onMoveLater, onMakePrimary, onArchive, onRestore, onFocalChange,
}: ImageGalleryProps) => {
  const readyCount = variant.ready_images.length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {variant.ready_images.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No photographs for this variant yet.
          </Text>
        ) : (
          variant.ready_images.map((image, position) => (
            <ReadyImageCard
              key={image.id}
              image={image}
              position={position}
              readyCount={readyCount}
              onMoveEarlier={() => onMoveEarlier(image.id)}
              onMoveLater={() => onMoveLater(image.id)}
              onMakePrimary={() => onMakePrimary(image.id)}
              onArchive={() => onArchive(image.id)}
              onFocalChange={(position) => onFocalChange(image.id, position)}
            />
          ))
        )}
      </div>

      {variant.archived_images.length > 0 && (
        <Container className="flex flex-col gap-3 p-4">
          <Text size="small" weight="plus">
            Archived
          </Text>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {variant.archived_images.map((image) => (
              <div key={image.id} className="flex flex-col gap-2 border p-3">
                {image.imageUrl && (
                  <img src={image.imageUrl} alt={image.originalFilename} className="max-h-32 w-auto border" />
                )}
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {image.originalFilename}
                </Text>
                <Button size="small" variant="secondary" onClick={() => onRestore(image.id)}>
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </Container>
      )}
    </div>
  )
}

export default ImageGallery
