import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@lib/utils"

/**
 * Holo Trail Alert: a boxed status message using the functional UI status
 * colours. Square corners, tinted surface, coloured border and heading.
 * Status is never communicated by colour alone — provide a title and/or an
 * icon in addition to the variant.
 */
const alertVariants = cva(
  "ht-body-sm w-full rounded-none border p-4 text-ink",
  {
    variants: {
      variant: {
        info: "border-info bg-info-surface",
        success: "border-success bg-success-surface",
        warning: "border-warning bg-warning-surface",
        error: "border-danger bg-danger-surface",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
)

const titleColor: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  string
> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-danger",
}

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string
  /** Optional decorative icon; it is hidden from assistive technology. */
  icon?: React.ReactNode
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", title, icon, children, role, ...props }, ref) => {
    const resolvedVariant = variant ?? "info"
    // Errors and warnings are assertive; info and success are polite.
    const resolvedRole =
      role ??
      (resolvedVariant === "error" || resolvedVariant === "warning"
        ? "alert"
        : "status")

    return (
      <div
        ref={ref}
        role={resolvedRole}
        className={cn(alertVariants({ variant: resolvedVariant }), className)}
        {...props}
      >
        <div className="flex gap-3">
          {icon && (
            <span aria-hidden="true" className={cn("shrink-0", titleColor[resolvedVariant])}>
              {icon}
            </span>
          )}
          <div className="flex flex-col gap-1">
            {title && (
              <p className={cn("ht-label", titleColor[resolvedVariant])}>{title}</p>
            )}
            {children && <div>{children}</div>}
          </div>
        </div>
      </div>
    )
  }
)
Alert.displayName = "Alert"

export { Alert, alertVariants }
