import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { fetchJson, postAction } from "../../../../../components/imports/fetch-json";

type Proposal = {
  id: string;
  changeKind: string;
  reviewStatus: string;
  proposedEbayStoreCategoryId: string | null;
  proposedCategoryReason: string | null;
  confirmedEbayStoreCategoryId: string | null;
  categoryConfirmedAt: string | null;
  categoryConfirmedBy: string | null;
};
type Category = { id: string; name: string; path: string; status: "ACTIVE" | "REMOVED" };
type Catalogue = { accountId: string; categories: Category[] };

/**
 * E2B category review/confirm screen for one inventory proposal. A displayed
 * proposal is never treated as confirmation — this page's "Confirm" and
 * "Choose a different category" actions are the only ways to populate
 * `confirmedEbayStoreCategoryId`, and an in-scope proposal (a brand-new
 * holding) cannot be applied until that is set to a still-active category.
 */
const ProposalCategoryPage = () => {
  const params = useParams<{ proposalId: string }>();
  const proposalId = params.proposalId ?? "";
  const client = useQueryClient();
  const [environment, setEnvironment] = useState("SANDBOX");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const proposalQuery = useQuery({
    queryKey: ["inventory-proposal", proposalId],
    queryFn: () => fetchJson<{ proposal: Proposal }>(`/admin/trading-card-inventory/proposals/${encodeURIComponent(proposalId)}`),
    enabled: Boolean(proposalId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["ebay-store-categories", environment],
    queryFn: () => fetchJson<Catalogue>(`/admin/ebay/store-categories?environment=${environment}`),
    retry: false,
  });
  const activeCategories = (categoriesQuery.data?.categories ?? []).filter((c) => c.status === "ACTIVE");

  const confirm = useMutation({
    mutationFn: (storeCategoryId: string) =>
      postAction(`/admin/trading-card-inventory/proposals/${encodeURIComponent(proposalId)}/category`, {
        environment,
        storeCategoryId,
      }),
    onSuccess: () => {
      toast.success("Category confirmed.");
      client.invalidateQueries({ queryKey: ["inventory-proposal", proposalId] });
    },
    onError: () => toast.error("This category could not be confirmed. It may no longer be active."),
  });

  const proposal = proposalQuery.data?.proposal;
  const categoryName = (id: string | null) =>
    id ? activeCategories.find((c) => c.id === id)?.path ?? id : "—";

  return (
    <div className="flex flex-col gap-6">
      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h1">Category assignment</Heading>
        {proposalQuery.isLoading && <Text size="small">Loading…</Text>}
        {proposalQuery.isError && <Text role="alert">This proposal could not be loaded.</Text>}
        {proposal && (
          <>
            <Text size="small" className="text-ui-fg-subtle">
              Proposal {proposal.id} · {proposal.changeKind} · {proposal.reviewStatus}
            </Text>
            <div>
              <Text size="small" weight="plus">
                Proposed category
              </Text>
              <Text size="small">
                {categoryName(proposal.proposedEbayStoreCategoryId)}
                {proposal.proposedCategoryReason ? ` — ${proposal.proposedCategoryReason}` : ""}
              </Text>
            </div>
            <div>
              <Text size="small" weight="plus">
                Confirmed category
              </Text>
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
        <select aria-label="Environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
          <option value="SANDBOX">Sandbox</option>
          <option value="PRODUCTION">Production</option>
        </select>
      </Container>

      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h2">Choose a category</Heading>
        {proposal?.proposedEbayStoreCategoryId && (
          <Button
            variant="primary"
            isLoading={confirm.isPending}
            onClick={() => confirm.mutate(proposal.proposedEbayStoreCategoryId as string)}
          >
            Accept proposal
          </Button>
        )}
        <select aria-label="Override category" value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>
          <option value="">— Choose a category —</option>
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.path}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={!selectedCategoryId}
          isLoading={confirm.isPending}
          onClick={() => confirm.mutate(selectedCategoryId)}
        >
          Confirm selected category
        </Button>
      </Container>
    </div>
  );
};

export default ProposalCategoryPage;
