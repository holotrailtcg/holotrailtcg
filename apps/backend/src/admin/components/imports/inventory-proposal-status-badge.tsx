import { Badge } from "@medusajs/ui"

interface InventoryProposalStatusBadgeProps {
  reviewStatus: string
  medusaSyncStatus: string
}

/**
 * `reviewStatus` describes the local, authoritative stock movement only;
 * `medusaSyncStatus` describes whether that result has reached Medusa yet.
 * These are always independent (see ADR 0011) — the combined label makes
 * both facts visible at once rather than collapsing them into one state.
 */
const InventoryProposalStatusBadge = ({ reviewStatus, medusaSyncStatus }: InventoryProposalStatusBadgeProps) => {
  if (reviewStatus === "APPLIED") {
    if (medusaSyncStatus === "SYNCED") {
      return <Badge className="ht-imports-badge" color="green" size="2xsmall">Inventory applied and synchronised</Badge>
    }
    if (medusaSyncStatus === "FAILED") {
      return <Badge className="ht-imports-badge" color="red" size="2xsmall">Inventory applied — Medusa sync failed</Badge>
    }
    return <Badge className="ht-imports-badge" color="orange" size="2xsmall">Inventory applied — Medusa sync pending</Badge>
  }
  if (reviewStatus === "APPROVED") {
    return <Badge className="ht-imports-badge" color="blue" size="2xsmall">Approved — not yet applied</Badge>
  }
  if (reviewStatus === "REJECTED") {
    return <Badge className="ht-imports-badge" color="grey" size="2xsmall">Rejected</Badge>
  }
  return <Badge className="ht-imports-badge" color="orange" size="2xsmall">Pending review</Badge>
}

export default InventoryProposalStatusBadge
