import * as React from "react"

import { cn } from "@lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Renders the field in an error state and wires aria-invalid. */
  hasError?: boolean
}

/**
 * Holo Trail text input. Square corners, brand tokens, accessible focus and
 * disabled states. Labelling is handled by <Label> or <FormField>.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", hasError, "aria-invalid": ariaInvalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={ariaInvalid ?? (hasError || undefined)}
        className={cn(
          "ht-body-sm flex h-11 w-full rounded-none border bg-surface px-3 py-2 text-ink",
          "placeholder:text-ink-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page",
          "disabled:cursor-not-allowed disabled:opacity-50",
          hasError
            ? "border-danger focus-visible:ring-danger"
            : "border-line-strong hover:border-ink-muted",
          className
        )}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
