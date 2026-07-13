import type { Metadata } from "next"
import Link from "next/link"

import { PageShell } from "@components/layout/page-shell"
import { ContentContainer } from "@components/layout/content-container"
import { Section } from "@components/layout/section"
import { BrandLogo } from "@components/brand/brand-logo"
import { Alert } from "@components/ui/alert"

export const metadata: Metadata = {
  title: "Privacy — Holo Trail TCG",
  description: "Our full privacy notice is being prepared.",
}

export default function PrivacyPage() {
  return (
    <PageShell surface="page">
      <ContentContainer as="header" className="py-6">
        <Link href="/coming-soon" className="inline-flex" aria-label="Holo Trail TCG home">
          <BrandLogo variant="primary" height={36} />
        </Link>
      </ContentContainer>

      <ContentContainer className="flex-1">
        <Section spacing="md" className="mx-auto max-w-2xl">
          <div className="flex flex-col gap-6">
            <h1 className="ht-heading-page text-ink">Privacy</h1>

            <Alert variant="info" title="Our full privacy notice is being prepared">
              This is a placeholder page. A complete privacy notice explaining
              exactly what we collect and why will be published before the store
              opens.
            </Alert>

            <p className="ht-body text-ink">
              For now, if you join our email list we will only use your details
              to email you about the launch, and you can unsubscribe at any time.
            </p>

            <div>
              <Link
                href="/coming-soon"
                className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                Back to Holo Trail TCG
              </Link>
            </div>
          </div>
        </Section>
      </ContentContainer>
    </PageShell>
  )
}
