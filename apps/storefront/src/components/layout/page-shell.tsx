import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@lib/utils"

const pageShellVariants = cva("flex min-h-screen w-full flex-col", {
  variants: {
    /** Page background surface. */
    surface: {
      page: "bg-page",
      store: "bg-store",
    },
  },
  defaultVariants: {
    surface: "page",
  },
})

export interface PageShellProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof pageShellVariants> {}

/**
 * PageShell owns the standard page background and top-level document layout.
 * Wrap a route's content in it so every page shares the brand background and a
 * consistent min-height column. Use `surface="store"` for shop pages.
 */
const PageShell = React.forwardRef<HTMLDivElement, PageShellProps>(
  ({ className, surface, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(pageShellVariants({ surface }), className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)
PageShell.displayName = "PageShell"

export { PageShell, pageShellVariants }
