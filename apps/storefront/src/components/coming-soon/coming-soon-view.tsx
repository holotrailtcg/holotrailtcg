import Image from "next/image"

import { SocialLinks } from "@components/brand/social-links"
import { ComingSoonBackground } from "@components/coming-soon/coming-soon-background"
import { ComingSoonHeader } from "@components/coming-soon/coming-soon-header"
import { COMING_SOON_BUILDING_IMAGE_PATH } from "@components/coming-soon/coming-soon-images"
import { NewsletterForm } from "@components/coming-soon/newsletter-form"
import { RecaptchaScript } from "@components/coming-soon/recaptcha-script"
import { ContentContainer } from "@components/layout/content-container"
import { PageShell } from "@components/layout/page-shell"
import { CookieConsent } from "@components/privacy/cookie-consent"
import { comingSoonContent } from "@content/coming-soon"

const content = comingSoonContent

/**
 * Shared presentation for the coming-soon page. Rendered by the country-aware
 * route entry point (`app/[countryCode]/coming-soon`). Internal links are
 * locale-aware: the route passes the resolved `countryCode` so navigation stays
 * within the same region the middleware selected.
 */
export function ComingSoonView({ countryCode }: { countryCode: string }) {
  const privacyHref = `/${countryCode}/privacy`
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ""

  return (
    <PageShell surface="page">
      <ComingSoonHeader />

      <section className="relative isolate flex min-h-[calc(100svh-5rem)] flex-col overflow-hidden bg-navy">
        <ComingSoonBackground />

        <ContentContainer className="relative z-10 flex flex-1 items-center py-16 sm:py-20">
          <div className="max-w-4xl">
            <h1 className="ht-display-hero text-ink-on-dark">
              {content.heroHeadline}
            </h1>
            <p className="ht-body-lg mt-6 max-w-2xl text-ink-on-dark">
              {content.heroSupporting}
            </p>
          </div>
        </ContentContainer>
      </section>

      <section
        aria-labelledby="join-list-heading"
        className="border-b border-line bg-page"
      >
        <ContentContainer className="grid gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:gap-20 lg:py-24">
          <div>
            <h2 id="join-list-heading" className="ht-heading-section text-ink">
              {content.form.heading}
            </h2>
            <p className="ht-body-lg mt-5 text-ink-muted">
              {content.benefitsIntro}
            </p>
            <ul className="mt-6 flex flex-col gap-4">
              {content.benefits.map((benefit) => (
                <li
                  key={benefit.key}
                  className="ht-body flex items-start gap-3 text-ink"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 inline-block h-2 w-2 shrink-0 bg-action"
                  />
                  {benefit.text}
                </li>
              ))}
            </ul>
          </div>

          <div className="w-full max-w-xl lg:justify-self-end">
            <NewsletterForm
              countryCode={countryCode}
              recaptchaSiteKey={recaptchaSiteKey}
              privacyHref={privacyHref}
            />
          </div>
        </ContentContainer>
      </section>

      <section
        aria-labelledby="what-were-building-heading"
        className="relative isolate overflow-hidden bg-navy"
      >
        <Image
          src={COMING_SOON_BUILDING_IMAGE_PATH}
          alt=""
          fill
          loading="lazy"
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-navy opacity-70"
        />

        <ContentContainer className="relative z-10 py-16 sm:py-20 lg:py-24">
          <h2
            id="what-were-building-heading"
            className="ht-heading-section text-ink-on-dark"
          >
            {content.building.heading}
          </h2>
          <div className="mt-8 grid items-stretch gap-px border border-line bg-line md:grid-cols-3">
            {content.building.items.map((item) => (
              <article key={item.key} className="h-full bg-page p-6 sm:p-8">
                <h3 className="ht-heading-card text-ink">{item.heading}</h3>
                <p className="ht-body mt-4 text-ink-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </ContentContainer>
      </section>

      <section aria-labelledby="coming-soon-faq-heading" className="bg-page">
        <ContentContainer className="py-16 sm:py-20 lg:py-24">
          <div className="max-w-4xl">
            <h2
              id="coming-soon-faq-heading"
              className="ht-heading-section text-ink"
            >
              {content.faq.heading}
            </h2>
            <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
              {content.faq.items.map((item) => (
                <div key={item.key} className="border-t border-line pt-5">
                  <dt className="ht-heading-card text-ink">{item.question}</dt>
                  <dd className="ht-body mt-3 text-ink-muted">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </ContentContainer>
      </section>

      <footer className="border-t border-line bg-page">
        <ContentContainer className="flex flex-col gap-5 py-6">
          <p className="ht-caption max-w-4xl text-ink-muted">
            {content.trademarkDisclaimer}
          </p>
          <div className="flex flex-col items-center justify-between gap-4 border-t border-line pt-5 sm:flex-row">
            <p className="ht-caption">
              © {new Date().getFullYear()} Holo Trail TCG
            </p>
            <nav aria-label="Holo Trail TCG social media">
              <SocialLinks />
            </nav>
          </div>
        </ContentContainer>
      </footer>

      <CookieConsent />
      <RecaptchaScript siteKey={recaptchaSiteKey} />
    </PageShell>
  )
}
