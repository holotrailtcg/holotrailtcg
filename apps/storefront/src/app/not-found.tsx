import type { Metadata } from "next"
import Link from "next/link"

import { PageShell } from "@components/layout/page-shell"
import { ContentContainer } from "@components/layout/content-container"
import { BrandLogo } from "@components/brand/brand-logo"
import { buttonVariants } from "@components/ui/button"

export const metadata: Metadata = {
  title: "Page not found — Holo Trail TCG",
  description: "The page you were looking for could not be found.",
}

/**
 * Global 404. This renders for genuinely unmatched routes and returns a real
 * 404 response. It is outside the `[countryCode]` segment, so no locale is
 * available here; the return link points at the unprefixed `/coming-soon` and
 * the country-code middleware redirects it to the correct `/{country}/coming-soon`.
 */
export default function NotFound() {
  return (
    <PageShell surface="page">
      <ContentContainer className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
        <BrandLogo variant="primary" height={40} />
        <div className="flex flex-col gap-3">
          <p className="ht-label text-ink-muted">Error 404</p>
          <h1 className="ht-heading-page text-ink">Page not found</h1>
          <p className="ht-body mx-auto max-w-md text-ink-muted">
            We could not find the page you were looking for. It may have been
            moved, or the address may be slightly off.
          </p>
        </div>
        <Link href="/coming-soon" className={buttonVariants({ variant: "primary" })}>
          Back to Holo Trail TCG
        </Link>
      </ContentContainer>
    </PageShell>
  )
}
