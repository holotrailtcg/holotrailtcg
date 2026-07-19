import { Button, FocusModal } from "@medusajs/ui"

export interface ImagePreviewModalProps {
  imageUrl: string
  alt: string
  onClose: () => void
  /** Omit to show a read-only preview with no way to change the image. */
  onReplace?: () => void
}

/**
 * Read-only, full-size view of an already-assigned card image, reached by
 * clicking a thumbnail that has one. Deliberately separate from
 * `ReplaceCardImageDialog` (the upload/replace workflow) — this is just a
 * bigger look at what's already there, with an optional escape hatch into
 * that workflow via `onReplace`.
 */
const ImagePreviewModal = ({ imageUrl, alt, onClose, onReplace }: ImagePreviewModalProps) => (
  <FocusModal open onOpenChange={(open) => { if (!open) onClose() }}>
    <FocusModal.Content>
      <FocusModal.Header>
        {onReplace && (
          <Button variant="secondary" size="small" onClick={onReplace}>
            Replace image
          </Button>
        )}
      </FocusModal.Header>
      <FocusModal.Body className="flex items-center justify-center overflow-auto p-6">
        <img src={imageUrl} alt={alt} className="max-h-full max-w-full object-contain" />
      </FocusModal.Body>
    </FocusModal.Content>
  </FocusModal>
)

export default ImagePreviewModal
