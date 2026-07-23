import { Button, FocusModal, Input, Label, Switch, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { fetchJson, HttpError, patchAction } from "./fetch-json"

interface TradingCardDetail {
  card: { id: string; illustrator: string | null; illustrator_confirmed: boolean; updated_at: string }
}

interface EditIllustratorDialogProps {
  tradingCardId: string
  onClose: () => void
  onSaved: () => void
}

/**
 * Stage 1: the missing Admin surface for correcting an already-existing
 * card's illustrator (the PATCH route and `updateTradingCardIdentity` logic
 * already existed with no reviewer-facing UI). Illustrator is optional and
 * never part of canonical/variant identity — this dialog only ever edits
 * that one field, never the card's set/name/number, matching the narrow
 * "manual correction" scope for Stage 1.
 */
const EditIllustratorDialog = ({ tradingCardId, onClose, onSaved }: EditIllustratorDialogProps) => {
  const client = useQueryClient()
  const [illustrator, setIllustrator] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [touched, setTouched] = useState(false)

  const cardQuery = useQuery({
    queryKey: ["trading-card-detail", tradingCardId],
    queryFn: () => fetchJson<TradingCardDetail>(`/admin/trading-cards/${encodeURIComponent(tradingCardId)}`),
  })

  useEffect(() => {
    if (cardQuery.data && !touched) {
      setIllustrator(cardQuery.data.card.illustrator ?? "")
      setConfirmed(cardQuery.data.card.illustrator_confirmed)
    }
  }, [cardQuery.data, touched])

  const alreadyConfirmed = cardQuery.data?.card.illustrator_confirmed ?? false
  const [conflict, setConflict] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () => patchAction(`/admin/trading-cards/${encodeURIComponent(tradingCardId)}`, {
      illustrator: illustrator.trim() || null,
      illustratorConfirmed: confirmed,
      // Optimistic-concurrency guard: the exact `updated_at` this dialog loaded.
      // A stale request (someone else edited this card in between) is rejected
      // with a 409 rather than silently overwriting their change.
      expectedUpdatedAt: cardQuery.data?.card.updated_at ?? null,
    }),
    onSuccess: () => {
      toast.success("Illustrator updated.")
      client.invalidateQueries({ queryKey: ["trading-card-detail", tradingCardId] })
      client.invalidateQueries({ queryKey: ["card-images", tradingCardId] })
      onSaved()
      onClose()
    },
    onError: (error: Error) => {
      if (error instanceof HttpError && error.status === 409) {
        setConflict(true)
        toast.error("This card was changed by someone else since it was loaded — reload and try again.")
        return
      }
      toast.error(error.message || "This card could not be updated. Please try again.")
    },
  })

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) onClose() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Text weight="plus">Correct illustrator</Text>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 p-6">
          {cardQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
          {conflict && (
            <Text size="small" className="text-ui-fg-error">
              This card was changed by someone else since it was loaded. Reload before saving again.
            </Text>
          )}
          {alreadyConfirmed && (
            <Text size="small" className="text-ui-fg-subtle">
              This card's illustrator was manually confirmed — it will not be silently overwritten by TCGdex data.
            </Text>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="illustrator-input">Illustrator</Label>
            <Input
              id="illustrator-input"
              value={illustrator}
              onChange={(event) => { setIllustrator(event.target.value); setTouched(true) }}
              placeholder="e.g. Mitsuhiro Arita"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="illustrator-confirmed" checked={confirmed} onCheckedChange={(value) => { setConfirmed(value); setTouched(true) }} />
            <Label htmlFor="illustrator-confirmed">Confirm this value (protects it from future automatic overwrites)</Label>
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex items-center gap-2">
            <Button variant="transparent" onClick={onClose}>Cancel</Button>
            {conflict ? (
              <Button
                variant="secondary"
                onClick={() => { setConflict(false); setTouched(false); client.invalidateQueries({ queryKey: ["trading-card-detail", tradingCardId] }) }}
              >
                Reload
              </Button>
            ) : (
              <Button variant="primary" isLoading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                Save
              </Button>
            )}
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default EditIllustratorDialog
