import { Button, Container, Heading, Text, Tooltip } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import ReviewStatusBadge from "../../../../components/imports/review-status-badge"
import type { ReviewDetailResponse } from "../../../../components/imports/types"
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

const ImportsReviewDetailPage = () => {
  const params = useParams<{ proposalId: string }>()
  const proposalId = params.proposalId ?? ""

  const query = useQuery({
    queryKey: ["tcgdex-review", proposalId],
    queryFn: () => fetchReview(proposalId),
    enabled: Boolean(proposalId),
  })

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

          <Container className="flex items-center gap-3 p-6">
            <Tooltip content="Not available yet">
              <Button variant="primary" disabled>
                Approve
              </Button>
            </Tooltip>
            <Tooltip content="Not available yet">
              <Button variant="danger" disabled>
                Reject
              </Button>
            </Tooltip>
          </Container>
        </>
      )}
    </div>
  )
}

export default ImportsReviewDetailPage
