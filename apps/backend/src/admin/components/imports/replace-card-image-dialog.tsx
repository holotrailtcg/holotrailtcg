import { Button, FocusModal, Heading, Text, toast } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { fetchJson, postAction } from "./fetch-json"
import ImageUploadQueue from "./image-upload-queue"
import type { CardImageDetail, CardImageDto } from "./image-types"

interface ReplaceCardImageDialogProps {
  tradingCardId: string
  tradingCardVariantId: string
  onClose: () => void
  /** Called after a new image is confirmed READY, so the caller can refresh its thumbnail. */
  onUploaded: () => void
}

/**
 * Upload or replace the real photograph for one variant, reached by
 * clicking its thumbnail on the import review table. Mirrors the image
 * step of `create-card-dialog.tsx` (existing image reused / replace flow)
 * for a card that already exists, rather than one just created.
 */
const ReplaceCardImageDialog = ({ tradingCardId, tradingCardVariantId, onClose, onUploaded }: ReplaceCardImageDialogProps) => {
  const imagesQuery = useQuery({
    queryKey: ["card-images", tradingCardId],
    queryFn: () => fetchJson<CardImageDetail>(`/admin/trading-cards/${encodeURIComponent(tradingCardId)}/images`),
  })

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [replacing, setReplacing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [justUploaded, setJustUploaded] = useState<CardImageDto | null>(null)

  const variantGroup = imagesQuery.data?.variants.find((variant) => variant.id === tradingCardVariantId)
  const existingReadyImage = variantGroup?.ready_images[0] ?? null
  const showUploadControl = !existingReadyImage || replacing

  const handleUploaded = async (image: CardImageDto) => {
    setPendingFiles([])
    setJustUploaded(image)
    if (image.status !== "READY") {
      setUploadError("This image could not be saved. The previous image, if there was one, has been kept.")
      return
    }
    setUploadError(null)
    toast.success("Image saved")
    if (existingReadyImage && existingReadyImage.id !== image.id) {
      try {
        await postAction(`/admin/trading-cards/images/${encodeURIComponent(existingReadyImage.id)}/archive`)
      } catch {
        // best-effort — the new image is already saved and correct either way
      }
    }
    setReplacing(false)
    imagesQuery.refetch()
    onUploaded()
  }

  const handleClose = () => {
    setPendingFiles([])
    onClose()
  }

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) handleClose() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading level="h2">Card photograph</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 overflow-y-auto p-6">
          {imagesQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
          {imagesQuery.isError && <Text size="small" className="text-ui-fg-error">This card's images could not be loaded.</Text>}

          {existingReadyImage && !replacing && (
            <div className="flex flex-col gap-2">
              <Text size="small" weight="plus">Current image</Text>
              {existingReadyImage.imageUrl && (
                <img src={existingReadyImage.imageUrl} alt={existingReadyImage.originalFilename} className="h-40 w-auto object-contain" />
              )}
              <div className="flex gap-2">
                <Button size="small" variant="secondary" onClick={() => setReplacing(true)}>Replace image</Button>
              </div>
            </div>
          )}

          {showUploadControl && (
            <div className="flex flex-col gap-3">
              <Text size="small" weight="plus">{existingReadyImage ? "Replace image" : "Upload a photograph"}</Text>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  setPendingFiles(files)
                  event.target.value = ""
                }}
              />
              <ImageUploadQueue
                variantId={tradingCardVariantId}
                files={pendingFiles}
                onUploaded={handleUploaded}
              />
              {uploadError && <Text size="small" className="text-ui-fg-error">{uploadError}</Text>}
              {justUploaded && justUploaded.status === "READY" && !uploadError && (
                <Text size="small" className="text-ui-fg-subtle">Image saved.</Text>
              )}
            </div>
          )}
        </FocusModal.Body>
        <FocusModal.Footer>
          <Button variant="primary" onClick={handleClose}>Done</Button>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default ReplaceCardImageDialog
