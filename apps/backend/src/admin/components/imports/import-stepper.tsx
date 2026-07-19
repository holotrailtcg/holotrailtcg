import { Text } from "@medusajs/ui"
import { useLocation } from "react-router-dom"

export interface ImportStep {
  label: string
  description: string
  isActive: (pathname: string) => boolean
}

export const IMPORT_STEPS: ImportStep[] = [
  {
    label: "1. Upload and import",
    description: "Upload a Pulse CSV file and start an import.",
    isActive: (pathname) => pathname.startsWith("/imports/new"),
  },
  {
    label: "2. Sync with TCGdex",
    description: "Check the rows matched against your catalogue and TCGdex.",
    // `/imports/snapshots/:id/proposals` belongs to step 4, not this step,
    // even though it sits under the same `/imports/snapshots` prefix.
    isActive: (pathname) => pathname.startsWith("/imports/snapshots") && !pathname.includes("/proposals"),
  },
  {
    label: "3. Assign card images",
    description: "Add real Holo Trail photographs to each card.",
    isActive: (pathname) => pathname.startsWith("/imports/images"),
  },
  {
    label: "4. Check and approve",
    description: "Review and apply the suggested stock changes.",
    isActive: (pathname) => pathname.includes("/proposals"),
  },
]

interface ImportStepperProps {
  compact?: boolean
}

const ImportStepper = ({ compact = false }: ImportStepperProps) => {
  const location = useLocation()
  const activeIndex = IMPORT_STEPS.findIndex((step) => step.isActive(location.pathname))

  return (
    <ol className={compact ? "flex flex-wrap gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
      {IMPORT_STEPS.map((step, index) => {
        const isActive = index === activeIndex
        return (
          <li
            key={step.label}
            className={
              isActive
                ? "flex items-center gap-2 rounded-md border-2 border-ui-tag-green-icon bg-ui-tag-green-bg p-3"
                : "flex items-center gap-2 rounded-md border p-3"
            }
          >
            <div className="flex flex-col gap-1">
              <Text size="small" weight="plus">
                {step.label}
              </Text>
              {!compact && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {step.description}
                </Text>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default ImportStepper
