import { Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import ImportStepper from "../../../components/imports/import-stepper"
import NotConnectedNotice from "../../../components/imports/not-connected-notice"
import "../../../styles/imports.css"

const ImportsNewPage = () => {
  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Upload and import</Heading>
        <ImportStepper compact />
        <NotConnectedNotice message="Uploading a Pulse CSV file is not connected yet. Nothing you enter here would be received or stored. Check back once this step is built." />
        <Text size="small">
          <Link to="/imports">Back to imports</Link>
        </Text>
      </Container>
    </div>
  )
}

export default ImportsNewPage
