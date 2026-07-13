import * as React from "react"

import { cn } from "@lib/utils"

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Shows a required indicator after the label text. */
  required?: boolean
}

/**
 * Holo Trail form label. Uses the interface label type scale.
 */
const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => {
    return (
      <label ref={ref} className={cn("ht-label text-ink", className)} {...props}>
        {children}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
    )
  }
)
Label.displayName = "Label"

export { Label }
