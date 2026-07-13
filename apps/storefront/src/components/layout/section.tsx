import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@lib/utils"

const sectionVariants = cva("w-full", {
  variants: {
    /** Standard vertical rhythm between page sections. */
    spacing: {
      none: "py-0",
      sm: "py-8 sm:py-10",
      md: "py-12 sm:py-16",
      lg: "py-16 sm:py-24",
    },
  },
  defaultVariants: {
    spacing: "md",
  },
})

export interface SectionProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof sectionVariants> {}

/**
 * Section owns standard vertical section spacing and renders a semantic
 * <section>. Compose with ContentContainer for horizontal width.
 */
const Section = React.forwardRef<HTMLElement, SectionProps>(
  ({ className, spacing, children, ...props }, ref) => {
    return (
      <section
        ref={ref}
        className={cn(sectionVariants({ spacing }), className)}
        {...props}
      >
        {children}
      </section>
    )
  }
)
Section.displayName = "Section"

export { Section, sectionVariants }
