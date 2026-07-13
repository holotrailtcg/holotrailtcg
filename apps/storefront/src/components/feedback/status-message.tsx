import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@lib/utils"

/**
 * StatusMessage: a compact inline status line (icon + text) for form and
 * action feedback, e.g. under a field group or beside a submit button. For a
 * prominent boxed message use <Alert> instead.
 *
 * Status is not conveyed by colour alone: a visible prefix word is rendered
 * for assistive technology and sighted users, and an optional icon can be set.
 */
const statusMessageVariants = cva("ht-body-sm inline-flex items-center gap-2", {
  variants: {
    variant: {
      info: "text-info",
      success: "text-success",
      warning: "text-warning",
      error: "text-danger",
    },
  },
  defaultVariants: {
    variant: "info",
  },
})

const defaultPrefix: Record<
  NonNullable<VariantProps<typeof statusMessageVariants>["variant"]>,
  string
> = {
  info: "Note",
  success: "Success",
  warning: "Warning",
  error: "Error",
}

export interface StatusMessageProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof statusMessageVariants> {
  /** Optional decorative icon, hidden from assistive technology. */
  icon?: React.ReactNode
  /** Override the leading status word (set to "" to hide it). */
  prefix?: string
}

const StatusMessage = React.forwardRef<HTMLParagraphElement, StatusMessageProps>(
  ({ className, variant = "info", icon, prefix, role, children, ...props }, ref) => {
    const resolvedVariant = variant ?? "info"
    const resolvedRole =
      role ?? (resolvedVariant === "error" || resolvedVariant === "warning" ? "alert" : "status")
    const label = prefix ?? defaultPrefix[resolvedVariant]

    return (
      <p
        ref={ref}
        role={resolvedRole}
        className={cn(statusMessageVariants({ variant: resolvedVariant }), className)}
        {...props}
      >
        {icon && (
          <span aria-hidden="true" className="shrink-0">
            {icon}
          </span>
        )}
        <span>
          {label && <span className="font-semibold">{label}: </span>}
          {children}
        </span>
      </p>
    )
  }
)
StatusMessage.displayName = "StatusMessage"

export { StatusMessage, statusMessageVariants }
