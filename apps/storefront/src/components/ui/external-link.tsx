import * as React from "react"

import { cn } from "@lib/utils"

export interface ExternalLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Announce that the link opens in a new tab, for screen-reader users. */
  newTabLabel?: string
}

/**
 * Holo Trail external link. Always applies safe `rel` when it targets a new
 * tab and keeps accessible, on-brand link styling. Use <LocalizedClientLink>
 * for internal navigation; this is for outbound URLs.
 */
const ExternalLink = React.forwardRef<HTMLAnchorElement, ExternalLinkProps>(
  (
    {
      className,
      target,
      rel,
      children,
      newTabLabel = "opens in a new tab",
      ...props
    },
    ref
  ) => {
    const opensNewTab = target === "_blank"
    const resolvedRel =
      opensNewTab ? cn(rel, "noopener noreferrer").trim() : rel

    return (
      <a
        ref={ref}
        target={target}
        rel={resolvedRel || undefined}
        className={cn(
          "text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page",
          className
        )}
        {...props}
      >
        {children}
        {opensNewTab && <span className="sr-only"> ({newTabLabel})</span>}
      </a>
    )
  }
)
ExternalLink.displayName = "ExternalLink"

export { ExternalLink }
