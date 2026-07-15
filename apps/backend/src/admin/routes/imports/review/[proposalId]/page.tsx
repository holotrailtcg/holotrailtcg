import { Button, Container, Heading, Text, Textarea, Tooltip, toast, usePrompt } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import ReviewStatusBadge from "../../../../components/imports/review-status-badge"
import { MAX_REJECT_REASON_LENGTH, visibleReviewActions } from "../../../../components/imports/review-actions"
import type { ReviewDetailResponse, RetryResponse } from "../../../../components/imports/types"
import "../../../../styles/imports.css"

async function fetchReview(proposalId: string): Promise<ReviewDetailResponse> {
  const result = await fetch(`/admin/tcgdex/reviews/${encodeURIComponent(proposalId)}`, {
    credentials: "include",
  })
  if (!result.ok) {
    throw new Error("Request failed")
  }
  return result.json()
}

async function postAction<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const result = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  if (!result.ok) {
    throw new Error("Request failed")
  }
  return result.json()
}

const RETRY_OUTCOME_MESSAGE: Record<string, string> = {
  MATCHED: "TCGdex found a match. It is waiting for review.",
  NO_MATCH: "TCGdex could not find this card.",
  UNRESOLVED_SET: "TCGdex could not recognise this card's set.",
  IDENTITY_MISMATCH: "TCGdex returned a different card to the one expected.",
  INVALID_LOCAL_IDENTITY: "This card's details were not complete enough to check.",
  PROVIDER_ERROR: "TCGdex could not be reached. Please try again later.",
}

const ImportsReviewDetailPage = () => {
  const params = useParams<{ proposalId: string }>()
  const proposalId = params.proposalId ?? ""
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const [rejectReason, setRejectReason] = useState("")

  const query = useQuery({
    queryKey: ["tcgdex-review", proposalId],
    queryFn: () => fetchReview(proposalId),
    enabled: Boolean(proposalId),
  })

  const refreshAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: ["tcgdex-review", proposalId] })
    queryClient.invalidateQueries({ queryKey: ["tcgdex-reviews"] })
    queryClient.invalidateQueries({ queryKey: ["tcgdex-attempts"] })
  }

  const approveMutation = useMutation({
    mutationFn: () => postAction(`/admin/tcgdex/reviews/${encodeURIComponent(proposalId)}/approve`),
    onSuccess: () => {
      toast.success("Match approved")
      refreshAfterAction()
    },
    onError: () => toast.error("This match could not be approved. Please try again."),
  })

  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      postAction(`/admin/tcgdex/reviews/${encodeURIComponent(proposalId)}/reject`, reason ? { reason } : {}),
    onSuccess: () => {
      toast.success("Match rejected")
      refreshAfterAction()
    },
    onError: () => toast.error("This match could not be rejected. Please try again."),
  })

  const applyMutation = useMutation({
    mutationFn: () => postAction(`/admin/tcgdex/reviews/${encodeURIComponent(proposalId)}/apply`),
    onSuccess: () => {
      toast.success("Card details applied")
      refreshAfterAction()
    },
    onError: () => toast.error("These card details could not be applied. Please try again."),
  })

  const retryMutation = useMutation({
    mutationFn: () => {
      const tradingCardId = query.data?.review.trading_card.id ?? ""
      return postAction<RetryResponse>(`/admin/tcgdex/cards/${encodeURIComponent(tradingCardId)}/retry`)
    },
    onSuccess: (result) => {
      toast.info(RETRY_OUTCOME_MESSAGE[result.outcome] ?? "TCGdex was checked again.")
      refreshAfterAction()
    },
    onError: () => toast.error("TCGdex could not be reached. Please try again."),
  })

  const handleReject = async () => {
    const confirmed = await prompt({
      title: "Reject this match?",
      description: "This card will need to be matched again before it can be applied.",
      confirmText: "Reject",
      cancelText: "Cancel",
      variant: "danger",
    })
    if (confirmed) rejectMutation.mutate(rejectReason.trim())
  }

  const handleApply = async () => {
    const confirmed = await prompt({
      title: "Apply these card details?",
      description: "This copies the matched TCGdex details onto the Holo Trail card.",
      confirmText: "Apply",
      cancelText: "Cancel",
    })
    if (confirmed) applyMutation.mutate()
  }

  const actions = query.data ? visibleReviewActions(query.data.review.review_status) : null

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-2 p-6">
        <Text size="small">
          <Link to="/imports/review">Back to review</Link>
        </Text>
        {query.isLoading && (
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        )}
        {query.isError && (
          <Text size="small" className="text-ui-fg-error">
            This card could not be loaded. It may not exist, or something went wrong.
          </Text>
        )}
        {query.data && (
          <>
            <div className="flex items-center gap-3">
              <Heading level="h1">{query.data.review.trading_card.name}</Heading>
              <ReviewStatusBadge status={query.data.review.review_status} />
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {query.data.review.card_set.display_name} · {query.data.review.trading_card.card_number}
            </Text>
          </>
        )}
      </Container>

      {query.data && (
        <>
          <Container className="p-0">
            <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_auto]">
              <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                <Text size="small" weight="plus" className="text-ui-fg-subtle">
                  Field
                </Text>
                <Text size="small" weight="plus" className="text-ui-fg-subtle">
                  Holo Trail card
                </Text>
                <Text size="small" weight="plus" className="text-ui-fg-subtle">
                  TCGdex
                </Text>

                <Text size="small">Name</Text>
                <Text size="small">{query.data.review.trading_card.name}</Text>
                <Text size="small">{query.data.review.snapshot.name}</Text>

                <Text size="small">Number</Text>
                <Text size="small">{query.data.review.trading_card.card_number}</Text>
                <Text size="small">{query.data.review.snapshot.localId}</Text>

                <Text size="small">Set</Text>
                <Text size="small">{query.data.review.card_set.display_name}</Text>
                <Text size="small">{query.data.review.snapshot.providerSetId}</Text>

                <Text size="small">Language</Text>
                <Text size="small">{query.data.review.card_set.language}</Text>
                <Text size="small">—</Text>

                <Text size="small">Rarity</Text>
                <Text size="small">
                  {query.data.review.trading_card.rarity ?? query.data.review.trading_card.rarity_raw ?? "Unmapped"}
                </Text>
                <Text size="small">
                  {query.data.review.snapshot.rarityCandidate?.status === "MAPPED"
                    ? query.data.review.snapshot.rarityCandidate.rarity
                    : query.data.review.snapshot.rarityCandidate?.providerValue ??
                      query.data.review.snapshot.providerRarity ??
                      "—"}
                </Text>

                <Text size="small">Illustrator</Text>
                <Text size="small">—</Text>
                <Text size="small">{query.data.review.snapshot.illustrator ?? "—"}</Text>

                <Text size="small">Category</Text>
                <Text size="small">—</Text>
                <Text size="small">{query.data.review.snapshot.category}</Text>
              </div>

              {query.data.review.snapshot.referenceArtworkUrl && (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={query.data.review.snapshot.referenceArtworkUrl}
                    alt={`${query.data.review.snapshot.name} reference artwork from TCGdex`}
                    className="max-h-64 w-auto border"
                  />
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    TCGdex reference artwork
                  </Text>
                </div>
              )}
            </div>
          </Container>

          <Container className="flex flex-col gap-3 p-6">
            <Heading level="h2">History</Heading>
            {query.data.review.audit_history.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No history yet.
              </Text>
            ) : (
              <ul className="flex flex-col gap-2">
                {query.data.review.audit_history.map((entry) => (
                  <li key={entry.id}>
                    <Text size="small">
                      {entry.action} · {entry.actor} · {new Date(entry.created_at).toLocaleString()}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </Container>

          <Container className="flex flex-wrap items-center gap-3 p-6">
            {actions?.approve && (
              <Button
                variant="primary"
                isLoading={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
              >
                Approve
              </Button>
            )}
            {actions?.reject && (
              <Button
                variant="danger"
                isLoading={rejectMutation.isPending}
                onClick={handleReject}
              >
                Reject
              </Button>
            )}
            {actions?.apply && (
              <Button
                variant="primary"
                isLoading={applyMutation.isPending}
                onClick={handleApply}
              >
                Apply
              </Button>
            )}
            {actions?.retry && (
              <Button
                variant="secondary"
                isLoading={retryMutation.isPending}
                onClick={() => retryMutation.mutate()}
              >
                Try TCGdex again
              </Button>
            )}
            <Tooltip content="Not connected">
              <Button variant="secondary" disabled>
                Ignore
              </Button>
            </Tooltip>
          </Container>

          {actions?.reject && (
            <Container className="flex flex-col gap-2 p-6">
              <Text size="small" weight="plus">
                Reason for rejecting (optional)
              </Text>
              <Textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value.slice(0, MAX_REJECT_REASON_LENGTH))}
                placeholder="Why doesn't this match look right?"
                maxLength={MAX_REJECT_REASON_LENGTH}
              />
            </Container>
          )}
        </>
      )}
    </div>
  )
}

export default ImportsReviewDetailPage
