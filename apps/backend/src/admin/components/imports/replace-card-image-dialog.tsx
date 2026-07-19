import { Button, FocusModal, Text, toast } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { fetchJson, postAction } from "./fetch-json"
import ImageUploadQueue from "./image-upload-queue"
import type { CardImageDetail, CardImageDto } from "./image-types"

interface ReplaceCardImageDialogProps {
  tradingCardId: string
  tradingCardVariantId: string
  onClose: () => void
  onNext?: () => void
  showNext?: boolean
  /** Called after a new image is confirmed READY, so the caller can refresh its thumbnail. */
  onUploaded: () => void
}

/**
 * Upload or replace the real photograph for one variant, reached by
 * clicking its thumbnail on the import review table. Mirrors the image
 * step of `create-card-dialog.tsx` (existing image reused / replace flow)
 * for a card that already exists, rather than one just created.
 */
const ReplaceCardImageDialog = ({ tradingCardId, tradingCardVariantId, onClose, onNext, showNext = false, onUploaded }: ReplaceCardImageDialogProps) => {
  const imagesQuery = useQuery({
    queryKey: ["card-images", tradingCardId],
    queryFn: () => fetchJson<CardImageDetail>(`/admin/trading-cards/${encodeURIComponent(tradingCardId)}/images`),
  })

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [replacing, setReplacing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [justUploaded, setJustUploaded] = useState<CardImageDto | null>(null)

  const variantGroup = imagesQuery.data?.variants.find((variant) => variant.id === tradingCardVariantId)
  const existingReadyImage = variantGroup?.ready_images[0] ?? null
  const readyImages = variantGroup?.ready_images ?? []
  const showUploadControl = !existingReadyImage || replacing || adding

  const handleUploaded = async (image: CardImageDto) => {
    setJustUploaded(image)
    if (image.status !== "READY") {
      setUploadError("This image could not be saved. The previous image, if there was one, has been kept.")
      return
    }
    // Archiving the old primary image is what actually makes the new one
    // primary (`archiveCardImage` compacts the remaining ready images' sort
    // order, moving the new upload into position 0) — a replacement is not
    // complete until this succeeds. Reporting success beforehand, or when
    // this fails, would leave the old image as primary while telling the
    // reviewer the swap worked.
    if (replacing && existingReadyImage && existingReadyImage.id !== image.id) {
      try {
        await postAction(`/admin/trading-cards/images/${encodeURIComponent(existingReadyImage.id)}/archive`)
      } catch {
        setUploadError("The new photo was uploaded, but the old one could not be archived, so it is still the primary image. Please try again.")
        await imagesQuery.refetch()
        return
      }
    }
    setUploadError(null)
    toast.success("Image saved")
    await imagesQuery.refetch()
    onUploaded()
    if (replacing) {
      setReplacing(false)
      setPendingFiles([])
    }
  }

  const handleClose = () => {
    setPendingFiles([])
    setAdding(false)
    onClose()
  }

  const handleNext = () => {
    setPendingFiles([])
    setAdding(false)
    setReplacing(false)
    setUploadError(null)
    setJustUploaded(null)
    onNext?.()
  }

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) handleClose() }}>
      <FocusModal.Content className="!bottom-auto !left-1/2 !right-auto !top-1/2 h-auto max-h-[calc(100vh-3rem)] w-[min(42rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2">
        <FocusModal.Header>
          <div>
            <FocusModal.Title className="text-ui-fg-base text-base font-semibold">Card photograph</FocusModal.Title>
            <FocusModal.Description className="sr-only">Upload or replace the real photograph for this card.</FocusModal.Description>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 overflow-y-auto p-6">
          {imagesQuery.data && (
            <div>
              <Text size="small" weight="plus">{imagesQuery.data.trading_card.name}</Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {imagesQuery.data.card_set.display_name} · {imagesQuery.data.trading_card.card_number}
              </Text>
            </div>
          )}
          {imagesQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
          {imagesQuery.isError && <Text size="small" className="text-ui-fg-error">This card's images could not be loaded.</Text>}

          {existingReadyImage && !replacing && (
            <div className="flex flex-col gap-2">
              <Text size="small" weight="plus">
                {readyImages.length === 1 ? "Current image" : `Uploaded images (${readyImages.length})`}
              </Text>
              <div className={readyImages.length > 1 ? "grid gap-3 sm:grid-cols-2" : "grid grid-cols-1"}>
                {readyImages.map((image) => image.imageUrl && (
                  <img
                    key={image.id}
                    src={image.imageUrl}
                    alt={image.originalFilename}
                    className="max-h-[22rem] w-full rounded-md border object-contain"
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" variant="secondary" onClick={() => { setAdding(true); setReplacing(false) }}>Add more images</Button>
                <Button size="small" variant="secondary" onClick={() => { setReplacing(true); setAdding(false) }}>Replace image</Button>
              </div>
            </div>
          )}

          {showUploadControl && (
            <div className="flex flex-col gap-3">
              <Text size="small" weight="plus">
                {replacing ? "Replace image" : existingReadyImage ? "Add more images" : "Upload photographs"}
              </Text>
              <input
                type="file"
                multiple={!replacing}
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  if (!replacing && files.length > 0) setAdding(true)
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
        <FocusModal.Footer className="justify-between">
          <Button variant="secondary" onClick={handleClose}>Done</Button>
          {showNext && <Button variant="primary" disabled={!onNext} onClick={handleNext}>Next card →</Button>}
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default ReplaceCardImageDialog
