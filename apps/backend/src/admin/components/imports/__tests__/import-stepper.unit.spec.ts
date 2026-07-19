import { IMPORT_STEPS } from "../import-stepper"

function activeStepLabel(pathname: string): string | undefined {
  return IMPORT_STEPS.find((step) => step.isActive(pathname))?.label
}

describe("IMPORT_STEPS routing", () => {
  it("matches the upload page to step 1", () => {
    expect(activeStepLabel("/imports/new")).toBe("1. Upload and import")
  })

  it("matches a snapshot detail page to step 2, not step 4", () => {
    expect(activeStepLabel("/imports/snapshots/tcisnap_1")).toBe("2. Sync with TCGdex")
  })

  it("matches the plain snapshots list to step 2", () => {
    expect(activeStepLabel("/imports/snapshots")).toBe("2. Sync with TCGdex")
  })

  it("matches the images page to step 3", () => {
    expect(activeStepLabel("/imports/images")).toBe("3. Assign card images")
  })

  it("matches a snapshot's proposals page to step 4, not step 2", () => {
    expect(activeStepLabel("/imports/snapshots/tcisnap_1/proposals")).toBe("4. Check and approve")
  })

  it("matches nothing for an unrelated page", () => {
    expect(activeStepLabel("/imports")).toBeUndefined()
  })
})
