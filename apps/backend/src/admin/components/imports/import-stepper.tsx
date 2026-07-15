import { Badge, Text } from "@medusajs/ui"

export interface ImportStep {
  label: string
  description: string
  state: "connected" | "not_connected"
}

export const IMPORT_STEPS: ImportStep[] = [
  {
    label: "1. Upload and import",
    description: "Upload a Pulse CSV file and start an import.",
    state: "not_connected",
  },
  {
    label: "2. Sync with TCGdex",
    description: "See cards TCGdex has matched, ready to check.",
    state: "connected",
  },
  {
    label: "3. Assign card images",
    description: "Add real Holo Trail photographs to each card.",
    state: "not_connected",
  },
  {
    label: "4. Check and approve",
    description: "Check each match and approve it.",
    state: "connected",
  },
]

interface ImportStepperProps {
  compact?: boolean
}

const ImportStepper = ({ compact = false }: ImportStepperProps) => {
  return (
    <ol className={compact ? "flex flex-wrap gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
      {IMPORT_STEPS.map((step) => (
        <li key={step.label} className="flex items-center gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Text size="small" weight="plus">
                {step.label}
              </Text>
              <Badge
                className="ht-imports-badge"
                color={step.state === "connected" ? "green" : "grey"}
                size="2xsmall"
              >
                {step.state === "connected" ? "Connected" : "Not connected"}
              </Badge>
            </div>
            {!compact && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                {step.description}
              </Text>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export default ImportStepper
