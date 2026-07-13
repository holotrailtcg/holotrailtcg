"use client"

import * as React from "react"

import { cn } from "@lib/utils"

const BRAND_NAME = "Holo Trail TCG"

/**
 * Asset paths Scott must populate later (real SVGs, not reconstructions):
 *   public/brand/logo-primary.svg   -> full logo for light surfaces
 *   public/brand/logo-on-navy.svg   -> full logo for navy/contrast surfaces
 *   public/brand/logo-icon.svg      -> square icon / favicon-style mark
 *   public/brand/wordmark.svg       -> wordmark only
 *
 * Until the assets exist (or if one fails to load) BrandLogo renders an
 * accessible Barlow Condensed text wordmark, so nothing breaks.
 */
const LOGO_ASSETS = {
  primary: {
    light: "/brand/logo-primary.svg",
    navy: "/brand/logo-on-navy.svg",
  },
  wordmark: {
    light: "/brand/wordmark.svg",
    navy: "/brand/wordmark.svg",
  },
  icon: {
    light: "/brand/logo-icon.svg",
    navy: "/brand/logo-icon.svg",
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
