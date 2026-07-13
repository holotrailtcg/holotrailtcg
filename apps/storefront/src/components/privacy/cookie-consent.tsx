"use client"

import * as React from "react"

import { cn } from "@lib/utils"
import { Button } from "@components/ui/button"
import {
  decideConsent,
  readConsent,
  writeConsent,
} from "@lib/consent/store"

/**
 * Reusable cookie-consent UI. This stage is UI + local persistence only — it
 * does NOT load Google Analytics. Stage 2E reads the stored consent (via the
 * consent store) to decide whether to enable GA4.
 *
 * - Analytics is rejected by default and until an explicit choice is made.
 * - Reject is exactly as easy as accept (equal, adjacent buttons; one step).
 * - Essential cookies are always active and cannot be switched off.
 * - The preference can be changed later via the always-available trigger.
 */
export function CookieConsent() {
  const [mounted, setMounted] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [decided, setDecided] = React.useState(false)

  const dialogRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setMounted(true)
    const state = readConsent()
    setDecided(state.decided)
    if (!state.decided) setOpen(true)
  }, [])

  // Move focus to the dialog when it opens so keyboard users land on it.
  React.useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  const persist = React.useCallback((analytics: boolean) => {
    writeConsent(decideConsent(analytics))
    setDecided(true)
    setOpen(false)
  }, [])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Escape may dismiss the banner only once a decision already exists;
    // it must never be a way to silently skip an initial choice.
    if (event.key === "Escape" && decided) {
      setOpen(false)
    }
  }

  if (!mounted) return null

  const headingId = "cookie-consent-heading"
  const descriptionId = "cookie-consent-description"

  return (
    <>
      {/* Always-available way to revisit the preference. */}
      {!open && (
        <div className="fixed bottom-4 left-4 z-40 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-surface shadow-sm"
            onClick={() => setOpen(true)}
          >
            Cookie preferences
          </Button>
        </div>
      )}

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 border-t border-line-strong bg-surface",
            "focus-visible:outline-none print:hidden"
          )}
        >
          <div className="mx-auto flex max-w-content flex-col gap-4 px-[var(--ht-content-gutter)] py-5 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-1">
              <h2 id={headingId} className="ht-heading-card">
                Cookies
              </h2>
              <p id={descriptionId} className="ht-body-sm max-w-2xl">
                We use essential cookies to make this site work; these are
                always on. We would also like to use optional analytics cookies
                to understand how the site is used. Analytics stays off unless
                you accept. You can change this at any time.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => persist(false)}
              >
                Reject analytics
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => persist(true)}
              >
                Accept analytics
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
