import { Button, FocusModal, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { CONDITION_OPTIONS, FINISH_OPTIONS, SPECIAL_TREATMENT_OPTIONS } from "./card-dimension-options"
import { fetchJson, postAction } from "./fetch-json"
import ImageUploadQueue from "./image-upload-queue"
import type { CardImageDetail, CardImageDto } from "./image-types"
import type { InventoryProposalListItem, SnapshotEntryListResponse } from "./pulse-import-types"

interface CreateCardResult {
  tradingCardVariantId: string
  tradingCardId: string | null
  card: { name: string; setDisplayName: string | null; cardNumber: string; condition: string; finish: string; specialTreatment: string } | null
  tcgdexEnrichmentStatus: "TRIGGERED" | "FAILED_TO_TRIGGER"
}

interface CreateCardDialogProps {
  row: InventoryProposalListItem
  onClose: () => void
  /** Called once the card/variant/proposal have been created — the dialog itself stays open for the image step. */
  onCreated: () => void
}

type Phase = "form" | "submitting" | "image"

async function postCreateCard(body: Record<string, unknown>): Promise<{ status: number; result?: CreateCardResult }> {
  const response = await fetch("/admin/trading-cards/create-from-inventory-row", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (response.status === 409) return { status: 409 }
  if (!response.ok) throw new Error("Request failed")
  const data = (await response.json()) as { result: CreateCardResult }
  return { status: response.status, result: data.result }
}

/**
 * Reviewer flow for turning an unresolved Pulse import row into a real card:
 * confirm the card's identity and variant dimensions, create it, then
 * (optionally) attach a photograph using the existing variant-scoped R2
 * image pipeline. Card/variant/proposal creation is already committed by
 * the time the image step is reached — closing the dialog or an image
 * failure never undoes it.
 */
const CreateCardDialog = ({ row, onClose, onCreated }: CreateCardDialogProps) => {
  const [phase, setPhase] = useState<Phase>("form")
  const [cardSetDisplayName, setCardSetDisplayName] = useState("")
  const [name, setName] = useState("")
  const [cardNumber, setCardNumber] = useState("")
  const [rarityRaw, setRarityRaw] = useState("")
  const [condition, setCondition] = useState("")
  const [finish, setFinish] = useState("")
  const [finishConfirmed, setFinishConfirmed] = useState(false)
  const [specialTreatment, setSpecialTreatment] = useState("")
  const [specialTreatmentConfirmed, setSpecialTreatmentConfirmed] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateCardResult | null>(null)

  const entryQuery = useQuery({
    queryKey: ["snapshot-entry-for-proposal", row.inventorySnapshotId, row.providerReference],
    queryFn: () => {
      const searchParams = new URLSearchParams({ limit: "1", offset: "0", providerReference: row.providerReference ?? "" })
      return fetchJson<SnapshotEntryListResponse>(
        `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(row.inventorySnapshotId ?? "")}/entries?${searchParams.toString()}`
      )
    },
    enabled: Boolean(row.inventorySnapshotId && row.providerReference),
  })

  // Finish/special treatment are pre-filled from Pulse's parsed candidates, but only once —
  // the reviewer must still actively confirm them (see finishConfirmed/specialTreatmentConfirmed).
  useEffect(() => {
    const entry = entryQuery.data?.entries[0]
    if (!entry) return
    if (entry.finishCandidate) setFinish(entry.finishCandidate)
    if (entry.specialTreatmentCandidate) setSpecialTreatment(entry.specialTreatmentCandidate)
    if (entry.rarityRaw) setRarityRaw(entry.rarityRaw)
  }, [entryQuery.data])

  const imagesQuery = useQuery({
    queryKey: ["card-images", created?.tradingCardId],
    queryFn: () => fetchJson<CardImageDetail>(`/admin/trading-cards/${encodeURIComponent(created?.tradingCardId ?? "")}/images`),
    enabled: phase === "image" && Boolean(created?.tradingCardId),
  })

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [replacing, setReplacing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [justUploaded, setJustUploaded] = useState<CardImageDto | null>(null)

  const canSubmit = cardSetDisplayName.trim() && name.trim() && cardNumber.trim() &&
    condition && finish && finishConfirmed && specialTreatment && specialTreatmentConfirmed

  const handleSubmit = async () => {
    if (!canSubmit) return
    setPhase("submitting")
    setSubmitError(null)
    try {
      const { status, result } = await postCreateCard({
        inventoryProposalId: row.id,
        cardSetDisplayName: cardSetDisplayName.trim(),
        name: name.trim(),
        cardNumber: cardNumber.trim(),
        rarityRaw: rarityRaw.trim() || null,
        condition, finish, specialTreatment, finishConfirmed, specialTreatmentConfirmed,
      })
      if (status === 409) {
        setSubmitError("This row is already being created by another request. Please wait a moment and try again.")
        setPhase("form")
        return
      }
      if (!result) {
        setSubmitError("This card could not be created. Please try again.")
        setPhase("form")
        return
      }
      setCreated(result)
      toast.success("Card created")
      onCreated()
      setPhase("image")
    } catch {
      setSubmitError("This card could not be created. Please try again.")
      setPhase("form")
    }
  }

  const variantGroup = imagesQuery.data?.variants.find((variant) => variant.id === created?.tradingCardVariantId)
  const existingReadyImage = variantGroup?.ready_images[0] ?? null
  const showUploadControl = phase === "image" && (!existingReadyImage || replacing)

  const handleUploaded = async (image: CardImageDto) => {
    setPendingFiles([])
    setJustUploaded(image)
    if (image.status !== "READY") {
      setUploadError("This image could not be saved. The previous image, if there was one, has been kept.")
      return
    }
    setUploadError(null)
    toast.success("Image saved")
    // Archive the prior image only after the new one is confirmed READY —
    // never before, so a rejected replacement leaves the working image intact.
    if (existingReadyImage && existingReadyImage.id !== image.id) {
      try {
        await postAction(`/admin/trading-cards/images/${encodeURIComponent(existingReadyImage.id)}/archive`)
      } catch {
        // best-effort — the new image is already saved and correct either way
      }
    }
    setReplacing(false)
    imagesQuery.refetch()
  }

  const handleClose = () => {
    setPendingFiles([])
    onClose()
  }

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) handleClose() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading level="h2">{phase === "image" ? "Add a photograph" : "Create card"}</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-6 overflow-y-auto p-6">
          {phase !== "image" && (
            <div className="flex flex-col gap-4">
              <Text size="small" className="text-ui-fg-subtle">
                This row from the import could not be matched to a card already in the catalogue. Fill in its
                details below to add it. Row reference: {row.cardIdentityHint ?? row.providerReference ?? "—"}
              </Text>

              <div className="flex flex-col gap-1">
                <Label htmlFor="cc-set">Set name</Label>
                <Input id="cc-set" value={cardSetDisplayName} onChange={(event) => setCardSetDisplayName(event.target.value)} placeholder="e.g. Lost Origin" />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="cc-name">Card name</Label>
                <Input id="cc-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Gengar" />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="cc-number">Card number</Label>
                <Input id="cc-number" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} placeholder="e.g. 066/196" />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="cc-rarity">Rarity (optional)</Label>
                <Input id="cc-rarity" value={rarityRaw} onChange={(event) => setRarityRaw(event.target.value)} />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="cc-condition">Condition</Label>
                <select
                  id="cc-condition"
                  className="rounded-none border p-2 text-sm"
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                >
                  <option value="">Select the condition of this card</option>
                  {CONDITION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="cc-finish">Finish</Label>
                <select
                  id="cc-finish"
                  className="rounded-none border p-2 text-sm"
                  value={finish}
                  onChange={(event) => { setFinish(event.target.value); setFinishConfirmed(true) }}
                >
                  <option value="">Select the finish of this card</option>
                  {FINISH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {finish && !finishConfirmed ? "Suggested from the import — please check it and select it again to confirm." : null}
                </Text>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="cc-special">Special treatment</Label>
                <select
                  id="cc-special"
                  className="rounded-none border p-2 text-sm"
                  value={specialTreatment}
                  onChange={(event) => { setSpecialTreatment(event.target.value); setSpecialTreatmentConfirmed(true) }}
                >
                  <option value="">Select the special treatment of this card</option>
                  {SPECIAL_TREATMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {specialTreatment && !specialTreatmentConfirmed ? "Suggested from the import — please check it and select it again to confirm." : null}
                </Text>
              </div>

              {submitError && <Text size="small" className="text-ui-fg-error">{submitError}</Text>}
            </div>
          )}

          {phase === "image" && created && (
            <div className="flex flex-col gap-4">
              <Text size="small" className="text-ui-fg-subtle">
                {created.card?.name} · {created.card?.setDisplayName} · {created.card?.cardNumber} — the card has
                been created. You can add a photograph now, or do it later from "Cards needing images".
              </Text>

              {imagesQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}

              {existingReadyImage && !replacing && (
                <div className="flex flex-col gap-2">
                  <Text size="small" weight="plus">Existing image reused</Text>
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
                  {created.tradingCardVariantId && (
                    <ImageUploadQueue
                      variantId={created.tradingCardVariantId}
                      files={pendingFiles}
                      onUploaded={handleUploaded}
                    />
                  )}
                  {uploadError && <Text size="small" className="text-ui-fg-error">{uploadError}</Text>}
                  {justUploaded && justUploaded.status === "READY" && !uploadError && (
                    <Text size="small" className="text-ui-fg-subtle">Image saved.</Text>
                  )}
                </div>
              )}
            </div>
          )}
        </FocusModal.Body>
        <FocusModal.Footer>
          {phase !== "image" && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
              <Button variant="primary" isLoading={phase === "submitting"} disabled={!canSubmit} onClick={handleSubmit}>
                Create card
              </Button>
            </div>
          )}
          {phase === "image" && (
            <Button variant="primary" onClick={handleClose}>Done</Button>
          )}
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default CreateCardDialog
