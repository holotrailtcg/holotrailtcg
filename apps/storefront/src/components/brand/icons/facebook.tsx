import * as React from "react"

/**
 * Facebook glyph as a bespoke inline mark (not a new icon library). Decorative:
 * hidden from assistive technology — the link supplies the accessible name.
 * Inherits `currentColor`.
 */
export function FacebookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.412c0-3.026 1.792-4.697 4.533-4.697 1.313 0 2.686.235 2.686.235v2.968h-1.513c-1.49 0-1.955.93-1.955 1.886v2.266h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073Z" />
    </svg>
  )
}
