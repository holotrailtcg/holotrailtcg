import { BrandLogo } from "@components/brand/brand-logo"
import { ContentContainer } from "@components/layout/content-container"

/** A quiet, navigation-free header for the pre-launch storefront. */
export function ComingSoonHeader() {
  return (
    <header className="h-20 shrink-0 border-b border-line bg-page">
      <ContentContainer className="flex h-full items-center">
        <BrandLogo variant="primary" height={40} />
      </ContentContainer>
    </header>
  )
}
