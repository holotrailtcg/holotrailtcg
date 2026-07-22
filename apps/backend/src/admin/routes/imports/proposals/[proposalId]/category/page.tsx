import { useNavigate, useParams } from "react-router-dom";
import CategoryAssignmentDialog from "../../../../../components/imports/category-assignment-dialog";

/**
 * Direct-URL entry point for the category-confirmation dialog. The Step 4
 * review table opens the same dialog inline instead of navigating here —
 * this route exists for a bookmarked/shared link, closing back to wherever
 * the admin came from.
 */
const ProposalCategoryPage = () => {
  const params = useParams<{ proposalId: string }>();
  const navigate = useNavigate();
  const proposalId = params.proposalId ?? "";

  return (
    <CategoryAssignmentDialog
      proposalId={proposalId}
      onClose={() => navigate(-1)}
      onConfirmed={() => {}}
    />
  );
};

export default ProposalCategoryPage;
