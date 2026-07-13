import * as React from "react"

import { cn } from "@lib/utils"

export type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>

/**
 * Holo Trail checkbox: a native square checkbox styled with brand tokens.
 * Pair with <Label htmlFor> for an accessible name. Using the native input
 * keeps keyboard, form and screen-reader behaviour correct with no extra deps.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "h-4 w-4 shrink-0 appearance-none rounded-none border border-line-strong bg-surface",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page",
          "checked:border-action checked:bg-action",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
