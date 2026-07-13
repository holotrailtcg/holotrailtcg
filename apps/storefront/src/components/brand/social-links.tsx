import * as React from "react"

import { cn } from "@lib/utils"
import { socialLinks, type SocialPlatform } from "@content/social"
import { FacebookIcon } from "@components/brand/icons/facebook"
import { InstagramIcon } from "@components/brand/icons/instagram"

const ICONS: Record<
  SocialPlatform,
  (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element
> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
}

export interface SocialLinksProps
  extends React.HTMLAttributes<HTMLUListElement> {
  /** Icon size in pixels. */
  size?: number
}

/**
 * Reusable Holo Trail social links. Configuration lives in `content/social.ts`,
 * not here. Each link opens in a new tab with safe `rel` and carries an
 * accessible name; the icons are decorative (`aria-hidden`).
 */
function SocialLinks({ className, size = 20, ...props }: SocialLinksProps) {
  return (
    <ul className={cn("flex items-center gap-2", className)} {...props}>
      {socialLinks.map((link) => {
        const Icon = ICONS[link.platform]
        return (
          <li key={link.platform}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center text-ink",
                "transition-colors hover:bg-surface-alt hover:text-action",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              )}
            >
              <Icon width={size} height={size} />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export { SocialLinks }
