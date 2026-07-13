import * as React from "react"

import { cn } from "@lib/utils"

export type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>

/**
 * White check-mark drawn on the action-blue fill when checked. This is a
 * shape indicator, not just a colour change, so the checked state is legible
 * without relying on colour. It is a background image because a native
 * `appearance-none` checkbox cannot host a child element; keeping the native
 * input preserves keyboard, form and screen-reader semantics with no extra
 * icon dependency. The `#` is encoded as `%23` so the URL parses cleanly.
 */
const CHECK_ICON =
  "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='16'%20height='16'%20viewBox='0%200%2016%2016'%20fill='none'%20stroke='%23fff'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M4%208.5%206.5%2011%2012%205.5'/%3E%3C/svg%3E\")"

/**
 * Holo Trail checkbox: a native square checkbox styled with brand tokens.
 * Pair with <Label htmlFor> for an accessible name. Using the native input
 * keeps keyboard, form and screen-reader behaviour correct with no extra deps.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, style, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "h-4 w-4 shrink-0 appearance-none rounded-none border border-line-strong bg-surface",
          "bg-center bg-no-repeat",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page",
          "checked:border-action checked:bg-action checked:[background-image:var(--ht-checkbox-check)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={
          { "--ht-checkbox-check": CHECK_ICON, ...style } as React.CSSProperties
        }
        {...props}
      />
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
