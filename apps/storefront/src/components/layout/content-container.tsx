import * as React from "react"

import { cn } from "@lib/utils"

type PolymorphicProps<E extends React.ElementType> = {
  as?: E
  className?: string
  children?: React.ReactNode
} & Omit<React.ComponentPropsWithoutRef<E>, "as" | "className" | "children">

/**
 * ContentContainer owns the global maximum content width and the responsive
 * horizontal gutters. Both come from tokens (--ht-content-width /
 * --ht-content-gutter) so pages never hard-code widths.
 */
function ContentContainer<E extends React.ElementType = "div">({
  as,
  className,
  children,
  ...props
}: PolymorphicProps<E>) {
  const Component = (as ?? "div") as React.ElementType
  return (
    <Component
      className={cn(
        "mx-auto w-full max-w-content px-[var(--ht-content-gutter)]",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  )
}

export { ContentContainer }
