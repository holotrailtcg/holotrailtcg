import { comingSoonContent } from "@content/coming-soon"
import { PageShell } from "@components/layout/page-shell"
import { ContentContainer } from "@components/layout/content-container"
import { Section } from "@components/layout/section"
import { BrandLogo } from "@components/brand/brand-logo"
import { SocialLinks } from "@components/brand/social-links"
import { CookieConsent } from "@components/privacy/cookie-consent"
import { NewsletterForm } from "@components/coming-soon/newsletter-form"
import { HeroVisual } from "@components/coming-soon/hero-visual"

const content = comingSoonContent

/**
 * Shared presentation for the coming-soon page. Rendered by the country-aware
 * route entry point (`app/[countryCode]/coming-soon`). Internal links are
 * locale-aware: the route passes the resolved `countryCode` so navigation stays
 * within the same region the middleware selected.
 */
export function ComingSoonView({ countryCode }: { countryCode: string }) {
  const privacyHref = `/${countryCode}/privacy`

  return (
    <PageShell surface="page">
      {/* Top bar: brand mark + status. Inside <main>, so this is a section
          header, not the banner landmark. */}
      <ContentContainer
        as="header"
        className="flex items-center justify-between gap-4 py-6"
      >
        <BrandLogo variant="primary" height={40} />
        <span className="ht-label inline-flex items-center gap-2 border border-line-strong px-3 py-1 text-ink">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 bg-signal"
          />
          {content.status}
        </span>
      </ContentContainer>

      <ContentContainer className="flex-1">
        <Section spacing="md">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            {/* Left: message + benefits + form */}
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-4">
                <h1 className="ht-display-hero text-ink">
                  {content.heroHeadline}
                </h1>
                <p className="ht-body-lg max-w-xl text-ink-muted">
                  {content.heroSupporting}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <p className="ht-label text-ink">{content.benefitsIntro}</p>
                <ul className="flex flex-col gap-2">
                  {content.benefits.map((benefit) => (
                    <li
                      key={benefit.key}
                      className="ht-body flex items-start gap-3 text-ink"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 inline-block h-1.5 w-1.5 shrink-0 bg-action"
                      />
                      {benefit.text}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-4">
                <h2 className="ht-heading-card text-ink">
                  {content.form.heading}
                </h2>
                <div className="max-w-md">
                  <NewsletterForm privacyHref={privacyHref} />
                </div>
              </div>
            </div>

            {/* Right: intentional image area */}
            <div className="order-first lg:order-last">
              <HeroVisual />
            </div>
          </div>
        </Section>
      </ContentContainer>

      <ContentContainer
        as="footer"
        className="flex flex-col items-center justify-between gap-4 border-t border-line py-6 sm:flex-row"
      >
        <p className="ht-caption">
          © {new Date().getFullYear()} Holo Trail TCG
        </p>
        <nav aria-label="Holo Trail TCG social media">
          <SocialLinks />
        </nav>
      </ContentContainer>

      <CookieConsent />
    </PageShell>
  )
}
