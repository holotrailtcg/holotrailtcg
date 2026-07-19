import { Button, Container, FocusModal, Heading, Text, toast } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { fetchJson, postAction } from "./fetch-json"

interface UnmappedSetCodesResponse {
  language: string | null
  unmappedSetCodes: string[]
}

interface SuggestSetMappingResponse {
  candidates: Array<{ id: string; name: string }>
  sets: Array<{ id: string; name: string }>
}

interface SetMappingBannerProps {
  snapshotId: string
}

/**
 * "N sets need mapping" banner for the Sync step. Confirming a mapping here
 * only teaches the app the provider set code's real TCGdex identity — it
 * does not itself re-run matching or create any cards (that's a separate,
 * not-yet-built automatic-lookup step). Card creation for unmatched rows
 * still happens the existing way, via "Create card".
 */
const SetMappingBanner = ({ snapshotId }: SetMappingBannerProps) => {
  const queryClient = useQueryClient()
  const [activeSetCode, setActiveSetCode] = useState<string | null>(null)

  const unmappedQuery = useQuery({
    queryKey: ["provider-set-mappings-unmapped", snapshotId],
    queryFn: () => fetchJson<UnmappedSetCodesResponse>(
      `/admin/trading-cards/provider-set-mappings/unmapped?snapshotId=${encodeURIComponent(snapshotId)}`
    ),
    enabled: Boolean(snapshotId),
    placeholderData: keepPreviousData,
  })

  const language = unmappedQuery.data?.language ?? null
  const unmappedSetCodes = unmappedQuery.data?.unmappedSetCodes ?? []

  if (!language || unmappedSetCodes.length === 0) return null

  return (
    <Container className="flex flex-col gap-3 border-ui-tag-orange-border bg-ui-tag-orange-bg p-4">
      <Text size="small" weight="plus">
        {unmappedSetCodes.length} set{unmappedSetCodes.length === 1 ? "" : "s"} need{unmappedSetCodes.length === 1 ? "s" : ""} mapping before matching can continue
      </Text>
      <div className="flex flex-wrap gap-2">
        {unmappedSetCodes.map((setCode) => (
          <Button key={setCode} size="small" variant="secondary" onClick={() => setActiveSetCode(setCode)}>
            Map "{setCode}"
          </Button>
        ))}
      </div>

      {activeSetCode && (
        <ConfirmSetMappingDialog
          providerSetCode={activeSetCode}
          language={language}
          onClose={() => setActiveSetCode(null)}
          onConfirmed={() => {
            setActiveSetCode(null)
            queryClient.invalidateQueries({ queryKey: ["provider-set-mappings-unmapped", snapshotId] })
          }}
        />
      )}
    </Container>
  )
}

interface ConfirmSetMappingDialogProps {
  providerSetCode: string
  language: string
  onClose: () => void
  onConfirmed: () => void
}

const ConfirmSetMappingDialog = ({ providerSetCode, language, onClose, onConfirmed }: ConfirmSetMappingDialogProps) => {
  const [tcgdexSetId, setTcgdexSetId] = useState("")
  const [search, setSearch] = useState("")

  const suggestQuery = useQuery({
    queryKey: ["provider-set-mappings-suggest", providerSetCode, language],
    queryFn: () => fetchJson<SuggestSetMappingResponse>(
      `/admin/trading-cards/provider-set-mappings/suggest?providerSetCode=${encodeURIComponent(providerSetCode)}&language=${encodeURIComponent(language)}`
    ),
  })

  const confirmMutation = useMutation({
    mutationFn: (selectedTcgdexSetId: string) => postAction(`/admin/trading-cards/provider-set-mappings`, {
      provider: "PULSE", game: "POKEMON", language, providerSetCode, tcgdexSetId: selectedTcgdexSetId,
    }),
    onSuccess: () => {
      toast.success("Set mapped")
      onConfirmed()
    },
    onError: () => toast.error("This set could not be mapped. Check the TCGdex set id and try again."),
  })

  const candidates = suggestQuery.data?.candidates ?? []
  const allSets = suggestQuery.data?.sets ?? []
  const searchResults = search.trim().length >= 2
    ? allSets.filter((set) =>
        set.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        set.id.toLowerCase().includes(search.trim().toLowerCase())
      ).slice(0, 25)
    : []

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) onClose() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading level="h2">Map "{providerSetCode}" to a TCGdex set</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 p-6">
          <Text size="small" className="text-ui-fg-subtle">
            This confirms which real TCGdex set your provider's own code refers to. It does not
            change any matching or create any cards by itself.
          </Text>

          {suggestQuery.isLoading && <Text size="small" className="text-ui-fg-subtle">Checking TCGdex…</Text>}

          {candidates.length > 0 && (
            <div className="flex flex-col gap-2">
              <Text size="small" weight="plus">Best guess</Text>
              {candidates.map((candidate) => (
                <Button
                  key={candidate.id}
                  variant="secondary"
                  className="justify-start"
                  isLoading={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate(candidate.id)}
                >
                  {candidate.name} ({candidate.id})
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Text size="small" weight="plus">Search TCGdex sets</Text>
            <input
              aria-label="Search TCGdex sets"
              className="border p-2 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by set name or id…"
            />
            {searchResults.length > 0 && (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto border p-1">
                {searchResults.map((set) => (
                  <Button
                    key={set.id}
                    size="small"
                    variant="transparent"
                    className="justify-start"
                    isLoading={confirmMutation.isPending}
                    onClick={() => confirmMutation.mutate(set.id)}
                  >
                    {set.name} ({set.id})
                  </Button>
                ))}
              </div>
            )}
            {search.trim().length >= 2 && searchResults.length === 0 && (
              <Text size="xsmall" className="text-ui-fg-subtle">No matching sets found.</Text>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Text size="small" weight="plus">Or enter the TCGdex set id directly</Text>
            <input
              aria-label="TCGdex set id"
              className="border p-2 text-sm"
              value={tcgdexSetId}
              onChange={(event) => setTcgdexSetId(event.target.value)}
              placeholder="e.g. swsh4.5"
            />
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!tcgdexSetId.trim()}
              isLoading={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate(tcgdexSetId.trim())}
            >
              Confirm mapping
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default SetMappingBanner
