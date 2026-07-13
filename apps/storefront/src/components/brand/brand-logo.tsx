"use client"

import * as React from "react"

import { cn } from "@lib/utils"

const BRAND_NAME = "Holo Trail TCG"

/**
 * Real approved brand assets (supplied in public/brand). "reverse" variants are
 * for navy/contrast surfaces. If an asset fails to load, BrandLogo falls back to
 * an accessible Barlow Condensed text wordmark, so nothing breaks.
 */
const LOGO_ASSETS = {
  primary: {
    light: "/brand/holotrailtcg-full-logo.png",
    navy: "/brand/holotrailtcg-full-logo-reverse.png",
  },
  wordmark: {
    light: "/brand/holotrailtcg-text-logo.png",
    navy: "/brand/holotrailtcg-text-logo-reverse.png",
  },
  icon: {
    light: "/brand/holotrailtcg-icon-logo.png",
    navy: "/brand/holotrailtcg-icon-logo-reverse.png",
  },
} as const

export interface BrandLogoProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Which asset to attempt. */
  variant?: "primary" | "wordmark" | "icon"
  /** Surface the logo sits on; selects the asset and text-fallback colour. */
  context?: "light" | "navy"
  /** Rendered pixel height of the logo/mark. */
  height?: number
  /** Force the text fallback and never attempt to load an image. */
  textOnly?: boolean
}

/**
 * Reusable Holo Trail identity mark. Wrap in a link at the call site for
 * navigation; this component only renders the mark and its text fallback.
 */
function BrandLogo({
  variant = "primary",
  context = "light",
  height = 32,
  textOnly = false,
  className,
  ...props
}: BrandLogoProps) {
  const [failed, setFailed] = React.useState(false)
  const src = LOGO_ASSETS[variant][context]
  const showText = textOnly || failed

  return (
    <span
      className={cn("inline-flex items-center", className)}
      aria-label={BRAND_NAME}
      role="img"
      {...props}
    >
      {showText ? (
        <span
          aria-hidden="true"
          className={cn(
            "font-display font-semibold uppercase leading-none tracking-tight",
            context === "navy" ? "text-ink-on-dark" : "text-ink"
          )}
          style={{ fontSize: height }}
        >
          {BRAND_NAME}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- brand asset may be absent; we fall back to text on error rather than failing the build via next/image
        <img
          src={src}
          alt=""
          height={height}
          style={{ height }}
          className="w-auto"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}

export { BrandLogo }
