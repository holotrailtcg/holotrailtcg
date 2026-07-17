import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import ImportStepper from "../../components/imports/import-stepper"
import "../../styles/imports.css"

interface OverviewCardProps {
  title: string
  description: string
  href: string | null
  connected: boolean
}

const OverviewCard = ({ title, description, href, connected }: OverviewCardProps) => {
  const content = (
    <Container className="flex h-full flex-col gap-2 p-4">
      <Heading level="h3">{title}</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        {description}
      </Text>
      <Text size="xsmall" className="mt-auto text-ui-fg-muted">
        {connected ? "Connected" : "Not connected yet"}
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
          This page shows the four steps for bringing new cards into Holo Trail. All four steps
          are connected to real data now.
        </Text>
      </Container>

      <ImportStepper />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewCard
          title="1. Upload and import"
          description="Upload a Pulse CSV file and start an import."
          href="/imports/new"
          connected
        />
        <OverviewCard
          title="2. Sync with TCGdex"
          description="See cards TCGdex has matched, ready to check."
          href="/imports/review"
          connected
        />
        <OverviewCard
          title="3. Assign card images"
          description="Add real Holo Trail photographs to each card."
          href="/imports/images"
          connected
        />
        <OverviewCard
          title="4. Check and approve"
          description="Check each import snapshot, then review and apply its inventory proposals."
          href="/imports/snapshots"
          connected
        />
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Imports",
})

export default ImportsOverviewPage
