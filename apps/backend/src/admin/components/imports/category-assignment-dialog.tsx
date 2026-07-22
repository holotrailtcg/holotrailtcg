import { Badge, Button, FocusModal, Select, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { fetchJson, postAction } from "./fetch-json"
import { formatEnumLabel } from "./format-enum-label"
import { SearchableCategorySelect } from "../ebay/searchable-category-select"
import type { StoreCategoryLike } from "../ebay/category-tree"

const CHANGE_KIND_LABEL: Record<string, string> = { NEW_HOLDING: "New stock", QUANTITY_CHANGE: "Quantity change" }

interface Proposal {
  id: string
  changeKind: string
  reviewStatus: string
  proposedEbayStoreCategoryId: string | null
  proposedCategoryReason: string | null
  confirmedEbayStoreCategoryId: string | null
}
type Category = StoreCategoryLike
interface Catalogue { accountId: string; categories: Category[] }

interface CategoryAssignmentDialogProps {
  proposalId: string
  onClose: () => void
  onNext?: () => void
  showNext?: boolean
  /** Called after a category is confirmed, so the caller can refresh its own row state. */
  onConfirmed: () => void
}

/**
 * Confirm (or override) the eBay Store category for one NEW_HOLDING
 * proposal, reached from the Step 4 review table. Mirrors
 * `ReplaceCardImageDialog`'s modal + "Next" pattern so reviewing several
 * rows in a row doesn't require navigating back to the table each time.
 */
const CategoryAssignmentDialog = ({ proposalId, onClose, onNext, showNext = false, onConfirmed }: CategoryAssignmentDialogProps) => {
  const client = useQueryClient()
  const [environment, setEnvironment] = useState("SANDBOX")
  const [selectedCategoryId, setSelectedCategoryId] = useState("")

  const proposalQuery = useQuery({
    queryKey: ["inventory-proposal", proposalId],
    queryFn: () => fetchJson<{ proposal: Proposal }>(`/admin/trading-card-inventory/proposals/${encodeURIComponent(proposalId)}`),
  })
  const categoriesQuery = useQuery({
    queryKey: ["ebay-store-categories", environment],
    queryFn: () => fetchJson<Catalogue>(`/admin/ebay/store-categories?environment=${environment}`),
    retry: false,
  })
  const activeCategories = (categoriesQuery.data?.categories ?? []).filter((c) => c.status === "ACTIVE")

  const confirm = useMutation({
    mutationFn: (storeCategoryId: string) =>
      postAction(`/admin/trading-card-inventory/proposals/${encodeURIComponent(proposalId)}/category`, { environment, storeCategoryId }),
    onSuccess: () => {
      toast.success("Category confirmed.")
      client.invalidateQueries({ queryKey: ["inventory-proposal", proposalId] })
      onConfirmed()
    },
    onError: () => toast.error("This category could not be confirmed. It may no longer be active."),
  })

  const proposal = proposalQuery.data?.proposal
  const categoryName = (id: string | null) => (id ? activeCategories.find((c) => c.id === id)?.path ?? id : "—")

  const handleNext = () => {
    setSelectedCategoryId("")
    onNext?.()
  }

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) onClose() }}>
      <FocusModal.Content className="!bottom-auto !left-1/2 !right-auto !top-1/2 h-[min(44rem,calc(100vh-4rem))] w-[min(48rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2">
        <FocusModal.Header>
          <div>
            <FocusModal.Title className="text-ui-fg-base text-base font-semibold">Category assignment</FocusModal.Title>
            <FocusModal.Description className="sr-only">Confirm or override the eBay Store category for this proposal.</FocusModal.Description>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 overflow-y-auto p-6">
          {proposalQuery.isLoading && <Text size="small">Loading…</Text>}
          {proposalQuery.isError && <Text role="alert">This proposal could not be loaded.</Text>}
          {proposal && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="2xsmall" color="blue">{CHANGE_KIND_LABEL[proposal.changeKind] ?? formatEnumLabel(proposal.changeKind)}</Badge>
                <Badge size="2xsmall" color="green">{formatEnumLabel(proposal.reviewStatus)}</Badge>
              </div>
              <div>
                <Text size="small" weight="plus">Proposed category</Text>
                <Text size="small">{categoryName(proposal.proposedEbayStoreCategoryId)}</Text>
                {proposal.proposedCategoryReason && (
                  <Text size="xsmall" className="text-ui-fg-subtle">{proposal.proposedCategoryReason}</Text>
                )}
              </div>
              <div>
                <Text size="small" weight="plus">Confirmed category</Text>
                {proposal.confirmedEbayStoreCategoryId ? (
                  <Badge>{categoryName(proposal.confirmedEbayStoreCategoryId)}</Badge>
                ) : (
                  <Text size="small" className="text-ui-fg-error">
                    Not confirmed — this row cannot be applied until a category is confirmed.
                  </Text>
                )}
              </div>
            </>
          )}
          <div className="flex flex-col gap-1">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">eBay environment</Text>
            <Select value={environment} onValueChange={setEnvironment}>
              <Select.Trigger aria-label="Environment">
                <Select.Value placeholder="Environment" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="SANDBOX">Sandbox</Select.Item>
                <Select.Item value="PRODUCTION">Production</Select.Item>
              </Select.Content>
            </Select>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4">
            <Text size="small" weight="plus">Choose a category</Text>
            {proposal?.proposedEbayStoreCategoryId && (
              <Button
                variant="primary"
                isLoading={confirm.isPending}
                onClick={() => confirm.mutate(proposal.proposedEbayStoreCategoryId as string)}
              >
                Accept proposal
              </Button>
            )}
            <SearchableCategorySelect
              id="override-category"
              ariaLabel="Override category"
              categories={activeCategories}
              value={selectedCategoryId}
              onChange={setSelectedCategoryId}
              placeholder="Search categories…"
            />
            <Button
              variant="secondary"
              disabled={!selectedCategoryId}
              isLoading={confirm.isPending}
              onClick={() => confirm.mutate(selectedCategoryId)}
            >
              Confirm selected category
            </Button>
          </div>
        </FocusModal.Body>
        <FocusModal.Footer className="justify-between">
          <Button variant="secondary" onClick={onClose}>Done</Button>
          {showNext && <Button variant="primary" disabled={!onNext} onClick={handleNext}>Next card →</Button>}
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default CategoryAssignmentDialog
