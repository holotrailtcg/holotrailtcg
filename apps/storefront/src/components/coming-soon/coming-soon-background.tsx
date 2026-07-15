import Image from "next/image"

import { COMING_SOON_HERO_IMAGE_PATH } from "./coming-soon-images"

/**
 * Decorative photography for the full-height coming-soon hero. The navy veil
 * keeps the reverse logo and introductory copy legible over varied crops.
 */
export function ComingSoonBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 z-0">
      <Image
        src={COMING_SOON_HERO_IMAGE_PATH}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-navy opacity-70" />
    </div>
  )
}
