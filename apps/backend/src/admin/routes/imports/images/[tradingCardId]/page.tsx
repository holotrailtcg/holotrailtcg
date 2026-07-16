import { Container, Heading, Tabs, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchJson, postAction } from "../../../../components/imports/fetch-json"
import type { FocalPosition } from "../../../../components/imports/focal-position-selector"
import { reorderedIds } from "../../../../components/imports/image-actions"
import ImageGallery from "../../../../components/imports/image-gallery"
import ImageQueryState from "../../../../components/imports/image-query-state"
import ImageUploadQueue from "../../../../components/imports/image-upload-queue"
import type { CardImageDetail, CardImageDto } from "../../../../components/imports/image-types"
import TcgdexReferenceArtworkPanel from "../../../../components/imports/tcgdex-reference-artwork-panel"
import { useArchiveConfirmation } from "../../../../components/imports/use-archive-confirmation"
import "../../../../styles/imports.css"

function fetchCardImages(tradingCardId: string): Promise<CardImageDetail> {
  return fetchJson(`/admin/trading-cards/${encodeURIComponent(tradingCardId)}/images`)
}

const ImportsImagesDetailPage = () => {
  const params = useParams<{ tradingCardId: string }>()
  const tradingCardId = params.tradingCardId ?? ""
  const queryClient = useQueryClient()
  const confirmArchive = useArchiveConfirmation()
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  const query = useQuery({
    queryKey: ["card-images", tradingCardId],
    queryFn: () => fetchCardImages(tradingCardId),
    enabled: Boolean(tradingCardId),
  })

  const refreshAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: ["card-images", tradingCardId] })
    queryClient.invalidateQueries({ queryKey: ["images-needing"] })
  }

  const reorderMutation = useMutation({
    mutationFn: ({ variantId, orderedImageIds }: { variantId: string; orderedImageIds: string[] }) =>
      postAction(`/admin/trading-cards/variants/${encodeURIComponent(variantId)}/images/reorder`, { orderedImageIds }),
    onSuccess: () => refreshAfterAction(),
    onError: () => toast.error("This image order could not be saved. Please try again."),
  })

  const archiveMutation = useMutation({
    mutationFn: (imageId: string) => postAction(`/admin/trading-cards/images/${encodeURIComponent(imageId)}/archive`),
    onSuccess: () => {
      toast.success("Image archived")
      refreshAfterAction()
    },
    onError: () => toast.error("This image could not be archived. Please try again."),
  })

  const restoreMutation = useMutation({
    mutationFn: (imageId: string) => postAction(`/admin/trading-cards/images/${encodeURIComponent(imageId)}/restore`),
    onSuccess: () => {
      toast.success("Image restored")
      refreshAfterAction()
    },
    onError: () => toast.error("This image could not be restored. Please try again."),
  })

  const focalPointMutation = useMutation({
    mutationFn: ({ imageId, position }: { imageId: string; position: FocalPosition }) =>
      postAction(`/admin/trading-cards/images/${encodeURIComponent(imageId)}/focal-point`, {
        focalX: position.x, focalY: position.y,
      }),
    onSuccess: () => {
      toast.success("Focal position saved")
      refreshAfterAction()
    },
    onError: () => toast.error("This focal position could not be saved. Please try again."),
  })

  const handleUploaded = () => {
    toast.success("Image uploaded")
    refreshAfterAction()
  }

  const variants = query.data?.variants ?? []
  const currentVariant = variants.find((variant) => variant.id === activeVariantId) ?? variants[0]

  const reorderFor = (variant: NonNullable<typeof currentVariant>, imageId: string, action: "earlier" | "later" | "primary") => {
    const currentIds = variant.ready_images.map((image: CardImageDto) => image.id)
    const orderedImageIds = reorderedIds(currentIds, imageId, action)
    reorderMutation.mutate({ variantId: variant.id, orderedImageIds })
  }

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-2 p-6">
        <Text size="small">
          <Link to="/imports/images">Back to cards needing images</Link>
        </Text>
        <ImageQueryState
          isLoading={query.isLoading}
          isError={query.isError}
          isEmpty={false}
          emptyMessage=""
          errorMessage="This card could not be loaded. It may not exist, or something went wrong."
        />
        {query.data && (
          <>
            <Heading level="h1">{query.data.trading_card.name}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {query.data.card_set.display_name} · {query.data.trading_card.card_number} · {query.data.card_set.language}
            </Text>
          </>
        )}
      </Container>

      {query.data && currentVariant && (
        <>
          <Tabs value={currentVariant.id} onValueChange={setActiveVariantId}>
            <Tabs.List>
              {variants.map((variant) => (
                <Tabs.Trigger key={variant.id} value={variant.id}>
                  {variant.condition} · {variant.finish}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs>

          <Container className="flex flex-col gap-3 p-6">
            <Text size="small" weight="plus">
              Upload photographs
            </Text>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                setPendingFiles(files)
                event.target.value = ""
              }}
            />
            <ImageUploadQueue
              variantId={currentVariant.id}
              files={pendingFiles}
              onUploaded={handleUploaded}
              onSettled={() => setPendingFiles([])}
            />
          </Container>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
            <Container className="p-6">
              <ImageGallery
                variant={currentVariant}
                onMoveEarlier={(imageId) => reorderFor(currentVariant, imageId, "earlier")}
                onMoveLater={(imageId) => reorderFor(currentVariant, imageId, "later")}
                onMakePrimary={(imageId) => reorderFor(currentVariant, imageId, "primary")}
                onArchive={async (imageId) => {
                  const confirmed = await confirmArchive()
                  if (confirmed) archiveMutation.mutate(imageId)
                }}
                onRestore={(imageId) => restoreMutation.mutate(imageId)}
                onFocalChange={(imageId, position) => focalPointMutation.mutate({ imageId, position })}
              />
            </Container>
            <TcgdexReferenceArtworkPanel
              url={query.data.tcgdex_reference_artwork_url}
              cardName={query.data.trading_card.name}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default ImportsImagesDetailPage
