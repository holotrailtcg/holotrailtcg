"use client"

import * as React from "react"

export function replaceSensitiveUrl(
  history: Pick<History, "replaceState" | "state">,
  cleanPathname: string,
): void {
  history.replaceState(history.state, "", cleanPathname)
}

/** Receives only a clean pathname; opaque newsletter tokens never cross here. */
export function UrlCleanup({ cleanPathname }: { cleanPathname: string }) {
  React.useEffect(() => {
    replaceSensitiveUrl(window.history, cleanPathname)
  }, [cleanPathname])

  return null
}
