/**
 * Social link configuration, kept out of page composition so links can be
 * edited or extended in one place. Consumed by the SocialLinks component.
 */

export type SocialPlatform = "facebook" | "instagram"

export type SocialLink = {
  platform: SocialPlatform
  /** Full outbound URL. */
  href: string
  /** Accessible name, e.g. announced by screen readers. */
  label: string
}

export const socialLinks: SocialLink[] = [
  {
    platform: "facebook",
    href: "https://www.facebook.com/holotrailtcg/about/",
    label: "Holo Trail TCG on Facebook",
  },
  {
    platform: "instagram",
    href: "https://www.instagram.com/holotrailtcg/",
    label: "Holo Trail TCG on Instagram",
  },
]
