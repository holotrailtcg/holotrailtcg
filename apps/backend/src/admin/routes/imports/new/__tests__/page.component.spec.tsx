/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { UploadCsvResult } from "../../../../components/imports/pulse-import-types"
import ImportsNewPage from "../page"

// See the sibling review-detail page spec for why every mock spy is created
// entirely inside its factory (swc/jest hoists `jest.mock` above top-level
// `const`s) — spies are reached afterwards through the mocked module itself.
jest.mock("react-router-dom", () => {
  const actual = jest.requireActual("react-router-dom")
  return { ...actual, useNavigate: () => jest.requireMock("react-router-dom").__mockNavigate, __mockNavigate: jest.fn() }
})

jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui")
  return { ...actual, toast: { ...actual.toast, success: jest.fn(), error: jest.fn(), info: jest.fn() } }
})

jest.mock("../../../../components/imports/upload-csv", () => ({
  PULSE_UPLOAD_MAX_BYTE_SIZE: 10 * 1024 * 1024,
  uploadCsv: jest.fn(),
}))

// Radix's `Select` requires pointer-capture APIs jsdom does not implement,
// so it never actually opens under `userEvent.click` in this environment.
// `SourceSelect` itself (the fetch-then-render-a-real-Select behaviour) is
// covered by inspection/manual verification; this page test only needs a
// stand-in that reports a chosen source id, so it swaps in a plain native
// `<select>` bound to the same `value`/`onChange` contract.
jest.mock("../../../../components/imports/source-select", () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select aria-label="Inventory source" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose an inventory source</option>
      <option value="tcisrc_1">Pulse Export A</option>
    </select>
  ),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedRouter = jest.requireMock("react-router-dom") as { __mockNavigate: jest.Mock }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedUi = jest.requireMock("@medusajs/ui") as { toast: { success: jest.Mock; error: jest.Mock; info: jest.Mock } }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedUpload = jest.requireMock("../../../../components/imports/upload-csv") as {
  uploadCsv: jest.Mock<Promise<{ status: number; body: UploadCsvResult }>>
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/imports/new"]}>
        <ImportsNewPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function chooseExistingSource(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Inventory source"), "tcisrc_1")
}

describe("ImportsNewPage", () => {
  beforeEach(() => {
    mockedRouter.__mockNavigate.mockClear()
    mockedUi.toast.success.mockClear()
    mockedUi.toast.error.mockClear()
    mockedUi.toast.info.mockClear()
    mockedUpload.uploadCsv.mockReset()
  })

  it("disables submit until both a source and a file are chosen", () => {
    renderPage()
    expect(screen.getByRole("button", { name: "Upload and import" })).toBeDisabled()
  })

  it("switches to the new-source fields and hides the source dropdown", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole("button", { name: "Create new source" }))
    expect(screen.getByPlaceholderText(/Source name/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Inventory source")).not.toBeInTheDocument()
  })

  it("uploads against an existing source and navigates to the snapshot preview on success", async () => {
    const user = userEvent.setup()
    mockedUpload.uploadCsv.mockResolvedValue({
      status: 201,
      body: {
        kind: "IMPORTED", snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", snapshotStatus: "PENDING_REVIEW",
        importSummary: { rowCount: 3 } as never, matchingSummary: {}, warnings: [],
      },
    })
    renderPage()

    await chooseExistingSource(user)
    const fileInput = screen.getByLabelText("Pulse CSV file") as HTMLInputElement
    const file = new File(["a,b\n1,2"], "import.csv", { type: "text/csv" })
    await user.upload(fileInput, file)

    const submit = screen.getByRole("button", { name: "Upload and import" })
    expect(submit).not.toBeDisabled()
    await user.click(submit)

    await waitFor(() => expect(mockedRouter.__mockNavigate).toHaveBeenCalledWith("/imports/snapshots/tcisnap_1"))
    expect(mockedUpload.uploadCsv).toHaveBeenCalledWith(expect.objectContaining({
      fields: { inventorySourceId: "tcisrc_1" },
    }))
  })

  it("shows the validation failure reason without navigating", async () => {
    const user = userEvent.setup()
    mockedUpload.uploadCsv.mockResolvedValue({
      status: 422,
      body: { kind: "VALIDATION_FAILED", reason: "Invalid CSV headers", diagnostics: [] },
    })
    renderPage()

    await chooseExistingSource(user)
    await user.upload(screen.getByLabelText("Pulse CSV file"), new File(["bad"], "bad.csv", { type: "text/csv" }))
    await user.click(screen.getByRole("button", { name: "Upload and import" }))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid CSV headers"))
    expect(mockedRouter.__mockNavigate).not.toHaveBeenCalled()
  })

  it("shows a duplicate-upload notice and still navigates to the existing snapshot", async () => {
    const user = userEvent.setup()
    mockedUpload.uploadCsv.mockResolvedValue({
      status: 200,
      body: { kind: "DUPLICATE", snapshotId: "tcisnap_existing", inventorySourceId: "tcisrc_1", snapshotStatus: "PENDING_REVIEW", importSummary: {} as never },
    })
    renderPage()

    await chooseExistingSource(user)
    await user.upload(screen.getByLabelText("Pulse CSV file"), new File(["a,b\n1,2"], "import.csv", { type: "text/csv" }))
    await user.click(screen.getByRole("button", { name: "Upload and import" }))

    await waitFor(() => expect(mockedUi.toast.info).toHaveBeenCalled())
    expect(mockedRouter.__mockNavigate).toHaveBeenCalledWith("/imports/snapshots/tcisnap_existing")
  })

  it("disables the submit button while the upload is in flight, preventing duplicate submissions", async () => {
    const user = userEvent.setup()
    let resolveUpload: (value: { status: number; body: UploadCsvResult }) => void = () => undefined
    mockedUpload.uploadCsv.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve }))
    renderPage()

    await chooseExistingSource(user)
    await user.upload(screen.getByLabelText("Pulse CSV file"), new File(["a,b\n1,2"], "import.csv", { type: "text/csv" }))

    const submit = screen.getByRole("button", { name: "Upload and import" })
    await user.click(submit)
    expect(submit).toBeDisabled()
    expect(mockedUpload.uploadCsv).toHaveBeenCalledTimes(1)

    resolveUpload({ status: 201, body: { kind: "IMPORTED", snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", snapshotStatus: "VALIDATED", importSummary: {} as never, matchingSummary: {}, warnings: [] } })
    await waitFor(() => expect(mockedRouter.__mockNavigate).toHaveBeenCalled())
  })
})
