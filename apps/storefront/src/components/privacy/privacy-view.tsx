import Link from "next/link"

import { BrandLogo } from "@components/brand/brand-logo"
import { ContentContainer } from "@components/layout/content-container"
import { PageShell } from "@components/layout/page-shell"
import { Section } from "@components/layout/section"
import { CookieConsent } from "@components/privacy/cookie-consent"
import { privacyContent } from "@content/privacy"
import { socialLinks } from "@content/social"

const content = privacyContent

/** Mailing-list privacy notice with locale-aware return navigation. */
export function PrivacyView({ countryCode }: { countryCode: string }) {
  const homeHref = `/${countryCode}/coming-soon`

  return (
    <PageShell surface="page">
      <ContentContainer as="header" className="border-b border-line py-6">
        <Link
          href={homeHref}
          className="inline-flex"
          aria-label="Holo Trail TCG home"
        >
          <BrandLogo variant="primary" height={36} />
        </Link>
      </ContentContainer>

      <ContentContainer className="flex-1">
        <Section spacing="md" className="mx-auto max-w-3xl">
          <article className="flex flex-col gap-10">
            <header>
              <h1 className="ht-heading-page text-ink">{content.heading}</h1>
              <p className="ht-caption mt-3 text-ink-muted">
                Last updated: {content.lastUpdated}
              </p>
              <p className="ht-body-lg mt-6 text-ink-muted">
                {content.introduction}
              </p>
            </header>

            {Object.values(content.sections).map((section) => (
              <section
                key={section.heading}
                className="border-t border-line pt-7"
              >
                <h2 className="ht-heading-card text-ink">{section.heading}</h2>
                <div className="mt-4 flex flex-col gap-4">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="ht-body text-ink-muted">
                      {paragraph}
                    </p>
                  ))}
                </div>

                {section.heading === "Cookies and local storage" ? (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3">
                    <a
                      href="https://policies.google.com/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      Google privacy policy
                    </a>
                    <a
                      href="https://policies.google.com/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      Google terms
                    </a>
                  </div>
                ) : section.heading === "Who we share information with" ? (
                  <div className="mt-5">
                    <a
                      href="https://resend.com/legal/privacy-policy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      Resend privacy policy
                    </a>
                  </div>
                ) : section.heading === "Contact us or complain" ? (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3">
                    {socialLinks.map((link) => (
                      <a
                        key={link.platform}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        Message us on {link.platform}
                      </a>
                    ))}
                    <a
                      href="https://ico.org.uk/make-a-complaint/data-protection-complaints/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      Complain to the ICO
                    </a>
                  </div>
                ) : null}
              </section>
            ))}

            <div>
              <Link
                href={homeHref}
                className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                Back to Holo Trail TCG
              </Link>
            </div>
          </article>
        </Section>
      </ContentContainer>
      <CookieConsent />
    </PageShell>
  )
}
