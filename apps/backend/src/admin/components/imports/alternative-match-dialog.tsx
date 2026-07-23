import { Button, FocusModal, Input, Label, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { fetchJson, postAction } from "./fetch-json"

interface TcgdexSet { id: string; name: string }
interface TcgdexCandidate { tcgdexSetId: string; tcgdexCardId: string; localId: string; name: string; image: string | null; setName: string }
type RematchResult =
  | { outcome: "REMATCHED"; tradingCardId: string; tradingCardVariantId: string; imageReassignmentWarning: boolean }
  | { outcome: "NO_EXISTING_CARD_OR_VARIANT" }

interface AlternativeMatchDialogProps {
  snapshotId: string
  entryId: string
  onClose: () => void
  onMatched: () => void
}

/**
 * Stage 1: lets a reviewer search TCGdex for a different card than whatever
 * a row currently resolves to, and select it. Only resolves to an already-
 * existing TradingCardVariant at the row's own condition/finish/treatment
 * (see selectAlternativeTcgdexMatchWorkflow) — a NO_EXISTING_CARD_OR_VARIANT
 * result means the reviewer should use "Create card" instead.
 */
const AlternativeMatchDialog = ({ snapshotId, entryId, onClose, onMatched }: AlternativeMatchDialogProps) => {
  const client = useQueryClient()
  const [selectedSetId, setSelectedSetId] = useState("")
  const [query, setQuery] = useState("")

  const summaryQuery = useQuery({
    queryKey: ["pulse-import-summary", snapshotId],
    queryFn: () => fetchJson<{ summary: { inventorySourceLanguage: string | null } }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/summary`,
    ),
  })
  const language = summaryQuery.data?.summary.inventorySourceLanguage ?? null

  const setsQuery = useQuery({
    queryKey: ["tcgdex-sets", language],
    queryFn: () => fetchJson<{ sets: TcgdexSet[] }>(`/admin/tcgdex/sets?language=${encodeURIComponent(language ?? "")}`),
    enabled: Boolean(language),
  })

  const cardsQuery = useQuery({
    queryKey: ["tcgdex-set-cards", language, selectedSetId, query],
    queryFn: () => fetchJson<{ candidates: TcgdexCandidate[] }>(
      `/admin/tcgdex/sets/${encodeURIComponent(selectedSetId)}/cards?language=${encodeURIComponent(language ?? "")}${query ? `&query=${encodeURIComponent(query)}` : ""}`,
    ),
    enabled: Boolean(language && selectedSetId),
  })

  const selectMutation = useMutation({
    mutationFn: (candidate: TcgdexCandidate) => postAction<{ result: RematchResult }>(
      `/admin/trading-card-inventory/imports/snapshots/${encodeURIComponent(snapshotId)}/entries/${encodeURIComponent(entryId)}/alternative-match`,
      { tcgdexSetId: candidate.tcgdexSetId, tcgdexCardId: candidate.tcgdexCardId },
    ),
    onSuccess: ({ result }) => {
      if (result.outcome === "REMATCHED") {
        toast.success(result.imageReassignmentWarning
          ? "Row rematched. Its existing photograph was NOT moved — that will be handled in a later stage."
          : "Row rematched to the selected card.")
        client.invalidateQueries({ queryKey: ["inventory-proposals"] })
        onMatched()
        onClose()
      } else {
        toast.error("No existing card/variant matches this identity yet. Use \"Create card\" to add it first.")
      }
    },
    onError: (error: Error) => toast.error(error.message || "This row could not be rematched. Please try again."),
  })

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) onClose() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Text weight="plus">Select an alternative TCGdex card</Text>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 p-6">
          {!language && <Text size="small" className="text-ui-fg-error">This snapshot's source has no configured language.</Text>}
          <div className="flex flex-col gap-1">
            <Label htmlFor="am-set">Set</Label>
            <select
              id="am-set"
              className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm"
              value={selectedSetId}
              onChange={(event) => setSelectedSetId(event.target.value)}
            >
              <option value="">Choose a set…</option>
              {(setsQuery.data?.sets ?? []).map((set) => (
                <option key={set.id} value={set.id}>{set.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="am-query">Card name or number</Label>
            <Input id="am-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Crobat V or 044" />
          </div>
          {cardsQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Searching…</Text>}
          <ul className="flex flex-col gap-2">
            {(cardsQuery.data?.candidates ?? []).map((candidate) => (
              <li key={candidate.tcgdexCardId} className="flex items-center gap-3 border-b py-2">
                {candidate.image && <img src={candidate.image} alt={candidate.name} className="h-16 w-auto object-contain" />}
                <div className="flex-1">
                  <Text size="small" weight="plus">{candidate.name}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">{candidate.setName} · #{candidate.localId}</Text>
                </div>
                <Button size="small" variant="secondary" isLoading={selectMutation.isPending} onClick={() => selectMutation.mutate(candidate)}>
                  Select
                </Button>
              </li>
            ))}
          </ul>
        </FocusModal.Body>
        <FocusModal.Footer>
          <Button variant="transparent" onClick={onClose}>Cancel</Button>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default AlternativeMatchDialog
