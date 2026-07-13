import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@lib/utils"

/**
 * Holo Trail Button. Square corners, brand tokens, sentence case.
 *
 * Variants:
 * - primary     action blue (the main call to action)
 * - secondary   restrained neutral fill
 * - outline     bordered, transparent fill
 * - ghost       transparent, subtle hover
 * - destructive functional error colour for irreversible actions
 *
 * Cyan is never a button background (signal-only). Purple stays restrained and
 * is not offered as a standard button colour.
 */
const buttonVariants = cva(
  "ht-button-text inline-flex items-center justify-center gap-2 rounded-none border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-action text-action-text hover:bg-action-hover active:bg-action-active",
        secondary:
          "bg-surface-alt text-ink border-line-strong hover:bg-surface active:bg-surface-alt",
        outline:
          "bg-transparent text-ink border-line-strong hover:bg-surface-alt active:bg-surface-alt",
        ghost:
          "bg-transparent text-ink hover:bg-surface-alt active:bg-surface-alt",
        destructive:
          "bg-danger text-white hover:opacity-90 active:opacity-100",
      },
      size: {
        sm: "h-9 px-3",
        md: "h-11 px-5",
        lg: "h-12 px-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-4 w-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, isLoading, disabled, children, ...props },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading && <Spinner />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
