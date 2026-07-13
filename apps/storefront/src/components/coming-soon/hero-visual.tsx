import { existsSync } from "fs"
import path from "path"
import Image from "next/image"

import { BrandLogo } from "@components/brand/brand-logo"

/**
 * Intentional image area for the coming-soon page.
 *
 * If the approved placeholder image exists it leads; otherwise we render a
 * branded visual treatment (navy panel + signal trail) rather than a broken
 * image. We never invent fake product photography. Per the Brand Guidelines,
 * real hobby/product photography should eventually lead here and support — not
 * dominate — the page.
 *
 * Asset Scott must supply (royalty-free, approved, collector/card-related):
 *   public/images/coming-soon/hero-placeholder.webp
 */
const HERO_IMAGE_PUBLIC_PATH = "/images/coming-soon/hero-placeholder.webp"

function heroImageExists(): boolean {
  try {
    return existsSync(
      path.join(process.cwd(), "public", "images", "coming-soon", "hero-placeholder.webp")
    )
  } catch {
    return false
  }
}

export function HeroVisual() {
  if (heroImageExists()) {
    return (
      <div className="relative h-full min-h-[16rem] w-full overflow-hidden bg-surface-alt">
        <Image
          src={HERO_IMAGE_PUBLIC_PATH}
          alt=""
          fill
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-cover"
          priority
        />
      </div>
    )
  }

  // Branded fallback: calm navy panel with the icon mark and a single signal
  // trail line. No neon washes, no glows, square edges.
  return (
    <div
      aria-hidden="true"
      className="relative flex h-full min-h-[16rem] w-full items-center justify-center overflow-hidden bg-navy"
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-signal" />
      <div className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 bg-signal" />
      <div className="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
        <BrandLogo variant="icon" context="navy" height={72} />
        <p className="ht-label text-ink-on-dark">Holo Trail TCG</p>
      </div>
    </div>
  )
}
