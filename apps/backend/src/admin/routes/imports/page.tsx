import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import RecentImportsPanel from "../../components/imports/recent-imports-panel"
import "../../styles/imports.css"

interface OverviewCardProps {
  title: string
  description: string
  href: string | null
}

const OverviewCard = ({ title, description, href }: OverviewCardProps) => {
  const content = (
    <Container className="flex h-full flex-col gap-2 p-4">
      <Heading level="h3">{title}</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        {description}
      </Text>
    </Container>
  )

  if (!href) {
    return content
  }

  return (
    <Link to={href} className="block h-full no-underline">
      {content}
    </Link>
  )
}

const ImportsOverviewPage = () => {
  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-2 p-6">
        <Heading level="h1">Import cards</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          This page shows the four steps for bringing new cards into Holo Trail. Work through them
          in order, top to bottom: upload a file, match cards, add photos, then check and approve
          the stock changes. If this is your first import, the card list will be empty — that is
          expected, since cards get added as you go through step 4.
        </Text>
      </Container>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewCard
          title="1. Upload and import"
          description="Upload a Pulse CSV file and start an import."
          href="/imports/new"
        />
        <OverviewCard
          title="2. Sync with TCGdex"
          description="Check the rows in your imported files, matched against your catalogue and TCGdex."
          href="/imports/snapshots"
        />
        <OverviewCard
          title="3. Assign card images"
          description="Add real Holo Trail photographs to each card."
          href="/imports/images"
        />
        <OverviewCard
          title="4. Check and approve"
          description="Check each import snapshot, then review and apply its inventory proposals."
          href="/imports/snapshots"
        />
      </div>

      <RecentImportsPanel />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Imports",
})

export default ImportsOverviewPage
