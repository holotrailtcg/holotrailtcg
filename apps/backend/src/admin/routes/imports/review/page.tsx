import { Button, Container, Heading, Tabs, Text } from "@medusajs/ui"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import AttemptOutcomeBadge from "../../../components/imports/attempt-outcome-badge"
import ImportStepper from "../../../components/imports/import-stepper"
import ReviewSearchFilterBar from "../../../components/imports/review-search-filter-bar"
import ReviewStatusBadge from "../../../components/imports/review-status-badge"
import ReviewTable, { type ReviewTableColumn } from "../../../components/imports/review-table"
import type {
  AttemptListItem,
  AttemptListResponse,
  ReviewListItem,
  ReviewListResponse,
} from "../../../components/imports/types"
import "../../../styles/imports.css"

const PAGE_SIZE = 20

const REVIEW_STATUS_OPTIONS = [
  { value: "PENDING", label: "Waiting for review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "APPLIED", label: "Applied" },
  { value: "SUPERSEDED", label: "Replaced by a newer match" },
]

const ATTEMPT_OUTCOME_OPTIONS = [
  { value: "NO_MATCH", label: "No match found" },
  { value: "UNRESOLVED_SET", label: "Card set not recognised" },
  { value: "IDENTITY_MISMATCH", label: "Card details did not match" },
  { value: "INVALID_LOCAL_IDENTITY", label: "Card details were incomplete" },
  { value: "PROVIDER_ERROR", label: "TCGdex could not be reached" },
]

async function fetchJson<T>(url: string): Promise<T> {
  const result = await fetch(url, { credentials: "include" })
  if (!result.ok) {
    throw new Error("Request failed")
  }
  return result.json()
}

interface PaginationBarProps {
  offset: number
  limit: number
  count: number
  onOffsetChange: (offset: number) => void
}

const PaginationBar = ({ offset, limit, count, onOffsetChange }: PaginationBarProps) => {
  if (count <= limit) {
    return null
  }

  const start = count === 0 ? 0 : offset + 1
  const end = Math.min(offset + limit, count)

  return (
    <div className="flex items-center justify-between p-4">
      <Text size="small" className="text-ui-fg-subtle">
        {start}-{end} of {count}
      </Text>
      <div className="flex gap-2">
        <Button
          size="small"
          variant="secondary"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={offset + limit >= count}
          onClick={() => onOffsetChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

const ProposalsTab = () => {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: ["tcgdex-reviews", { search, status, offset }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (search.trim()) params.set("q", search.trim())
      if (status) params.set("status", status)
      return fetchJson<ReviewListResponse>(`/admin/tcgdex/reviews?${params.toString()}`)
    },
    placeholderData: keepPreviousData,
  })

  const columns: ReviewTableColumn<ReviewListItem>[] = [
    { header: "Card", cell: (row) => row.trading_card.name },
    { header: "Set", cell: (row) => row.card_set.display_name },
    { header: "Number", cell: (row) => row.trading_card.card_number },
    { header: "Status", cell: (row) => <ReviewStatusBadge status={row.review_status} /> },
    { header: "Match source", cell: (row) => (row.match_source === "AUTOMATIC" ? "Automatic" : "Manual") },
    { header: "Updated", cell: (row) => new Date(row.updated_at).toLocaleString() },
  ]

  return (
    <div className="flex flex-col gap-4">
      <ReviewSearchFilterBar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setOffset(0)
        }}
        statusValue={status}
        onStatusChange={(value) => {
          setStatus(value)
          setOffset(0)
        }}
        statusOptions={REVIEW_STATUS_OPTIONS}
      />
      <Container className="divide-y p-0">
        <ReviewTable
          columns={columns}
          rows={query.data?.reviews ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/imports/review/${row.id}`)}
          isLoading={query.isLoading}
          isError={query.isError}
          emptyMessage={
            search || status
              ? "No cards match your search."
              : "No cards to review yet. TCGdex sync has not matched anything."
          }
        />
        {query.data && (
          <PaginationBar
            offset={offset}
            limit={query.data.limit}
            count={query.data.count}
            onOffsetChange={setOffset}
          />
        )}
      </Container>
    </div>
  )
}

const AttemptsTab = () => {
  const [search, setSearch] = useState("")
  const [outcome, setOutcome] = useState("")
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: ["tcgdex-attempts", { search, outcome, offset }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (search.trim()) params.set("q", search.trim())
      if (outcome) params.set("outcome", outcome)
      return fetchJson<AttemptListResponse>(`/admin/tcgdex/attempts?${params.toString()}`)
    },
    placeholderData: keepPreviousData,
  })

  const columns: ReviewTableColumn<AttemptListItem>[] = [
    { header: "Card", cell: (row) => row.trading_card.name },
    { header: "Set", cell: (row) => row.card_set.display_name },
    { header: "Number", cell: (row) => row.trading_card.card_number },
    { header: "Reason", cell: (row) => <AttemptOutcomeBadge outcome={row.outcome} /> },
    { header: "Match source", cell: (row) => (row.match_source === "AUTOMATIC" ? "Automatic" : "Manual") },
    { header: "Updated", cell: (row) => new Date(row.updated_at).toLocaleString() },
  ]

  return (
    <div className="flex flex-col gap-4">
      <ReviewSearchFilterBar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setOffset(0)
        }}
        statusValue={outcome}
        onStatusChange={(value) => {
          setOutcome(value)
          setOffset(0)
        }}
        statusOptions={ATTEMPT_OUTCOME_OPTIONS}
      />
      <Container className="divide-y p-0">
        <ReviewTable
          columns={columns}
          rows={query.data?.attempts ?? []}
          rowKey={(row) => row.id}
          isLoading={query.isLoading}
          isError={query.isError}
          emptyMessage={
            search || outcome
              ? "No cards match your search."
              : "No unmatched cards right now."
          }
        />
        {query.data && (
          <PaginationBar
            offset={offset}
            limit={query.data.limit}
            count={query.data.count}
            onOffsetChange={setOffset}
          />
        )}
      </Container>
    </div>
  )
}

const ImportsReviewPage = () => {
  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Sync with TCGdex</Heading>
        <ImportStepper compact />
        <Text size="small" className="text-ui-fg-subtle">
          Check the cards TCGdex has matched, and see cards it could not match.
        </Text>
        <Text size="small">
          <Link to="/imports">Back to imports</Link>
        </Text>
      </Container>

      <Tabs defaultValue="proposals">
        <Tabs.List>
          <Tabs.Trigger value="proposals">Sync with TCGdex</Tabs.Trigger>
          <Tabs.Trigger value="attempts">Not matched</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="proposals" className="pt-4">
          <ProposalsTab />
        </Tabs.Content>
        <Tabs.Content value="attempts" className="pt-4">
          <AttemptsTab />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

export default ImportsReviewPage
