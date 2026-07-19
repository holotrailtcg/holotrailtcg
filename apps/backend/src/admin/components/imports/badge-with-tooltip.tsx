import { Badge, Tooltip } from "@medusajs/ui"
import type { ReactNode } from "react"

/**
 * A status `Badge` with an on-hover/focus explanation. Built on Medusa UI's
 * `Tooltip` (a Radix Tooltip wrapper), which already implements the WAI-ARIA
 * tooltip pattern: keyboard-focusable trigger, Escape to dismiss, and an
 * `aria-describedby` link between trigger and content — so this stays
 * accessible without re-implementing that behaviour.
 */
interface BadgeWithTooltipProps {
  color: "grey" | "orange" | "red" | "green" | "blue" | "purple"
  tooltip: string
  children: ReactNode
}

const BadgeWithTooltip = ({ color, tooltip, children }: BadgeWithTooltipProps) => (
  <Tooltip content={tooltip}>
    <Badge className="ht-imports-badge" color={color} size="2xsmall">
      {children}
    </Badge>
  </Tooltip>
)

export default BadgeWithTooltip
