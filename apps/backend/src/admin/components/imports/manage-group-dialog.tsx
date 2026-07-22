import { Button, Checkbox, FocusModal, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { fetchJson, postAction } from "./fetch-json"
import { formatEnumLabel } from "./format-enum-label"

interface GroupEntry {
  id: string
  rowNumber: number | null
  providerReference: string
  quantity: number
  conditionCandidate: string | null
  finishCandidate: string | null
  specialTreatmentCandidate: string | null
  requiresSeparateListing: boolean
}

interface ManageGroupDialogProps {
  proposalId: string
  onClose: () => void
  /** Called after a split or separate-listing change succeeds, so the caller can refresh its own row state. */
  onChanged: () => void
}

/**
 * Stage 1: lets a reviewer split a wrongly-grouped proposal's rows into a
 * new sibling group, and/or override "does this card require a separate
 * listing?" for a selected subset (or the whole group). Both actions
 * operate on the same underlying row selection, so they share one dialog
 * rather than duplicating the row list twice.
 */
const ManageGroupDialog = ({ proposalId, onClose, onChanged }: ManageGroupDialogProps) => {
  const client = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const entriesQuery = useQuery({
    queryKey: ["proposal-group-entries", proposalId],
    queryFn: () => fetchJson<{ entries: GroupEntry[] }>(`/admin/trading-card-inventory/proposals/${encodeURIComponent(proposalId)}/entries`),
  })
  const entries = entriesQuery.data?.entries ?? []

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["proposal-group-entries", proposalId] })
    client.invalidateQueries({ queryKey: ["inventory-proposals"] })
    onChanged()
  }

  const splitMutation = useMutation({
    mutationFn: () => postAction(`/admin/trading-card-inventory/proposals/${encodeURIComponent(proposalId)}/split`, {
      sourceEntryIds: [...selected],
    }),
    onSuccess: (result: { alreadySplit: boolean }) => {
      toast.success(result.alreadySplit ? "These rows were already split into their own group." : "Selected rows were split into a new group.")
      setSelected(new Set())
      refresh()
    },
    onError: () => toast.error("This split could not be completed. Please try again."),
  })

  const setSeparateListing = useMutation({
    mutationFn: (requiresSeparateListing: boolean) => postAction(
      `/admin/trading-card-inventory/proposals/${encodeURIComponent(proposalId)}/separate-listing`,
      { requiresSeparateListing, ...(selected.size > 0 ? { sourceEntryIds: [...selected] } : {}) },
    ),
    onSuccess: () => {
      toast.success("Separate-listing intent updated.")
      setSelected(new Set())
      refresh()
    },
    onError: () => toast.error("This change could not be saved. Please try again."),
  })

  const canSplit = selected.size > 0 && selected.size < entries.length

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) onClose() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Text weight="plus">Manage group</Text>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 p-6">
          <Text size="small" className="text-ui-fg-subtle">
            Tick the rows that belong in a different group, then use Split. To change whether these
            cards need a separate listing, tick specific rows (or leave everything unticked to change
            the whole group) and choose Yes or No below.
          </Text>
          {entriesQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Loading…</Text>}
          {entriesQuery.isError && <Text size="small" className="text-ui-fg-error">These rows could not be loaded.</Text>}
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <label key={entry.id} className="flex items-center gap-3 border-b py-2 text-sm">
                <Checkbox checked={selected.has(entry.id)} onCheckedChange={() => toggle(entry.id)} />
                <span className="flex-1">
                  Line {entry.rowNumber ?? "—"} · {entry.providerReference} · qty {entry.quantity} ·{" "}
                  {formatEnumLabel(entry.conditionCandidate ?? "—")} / {formatEnumLabel(entry.finishCandidate ?? "—")} /{" "}
                  {formatEnumLabel(entry.specialTreatmentCandidate ?? "—")}
                </span>
                <span className="text-ui-fg-subtle text-xs">
                  {entry.requiresSeparateListing ? "Separate listing" : "Standard"}
                </span>
              </label>
            ))}
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={!canSplit}
              isLoading={splitMutation.isPending}
              onClick={() => splitMutation.mutate()}
            >
              Split selected into a new group
            </Button>
            <Button
              variant="secondary"
              isLoading={setSeparateListing.isPending}
              onClick={() => setSeparateListing.mutate(true)}
            >
              Mark {selected.size > 0 ? "selected" : "whole group"} as needing a separate listing
            </Button>
            <Button
              variant="secondary"
              isLoading={setSeparateListing.isPending}
              onClick={() => setSeparateListing.mutate(false)}
            >
              Mark {selected.size > 0 ? "selected" : "whole group"} as standard
            </Button>
            <Button variant="transparent" onClick={onClose}>Close</Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default ManageGroupDialog
