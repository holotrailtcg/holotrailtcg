/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import ImportsSnapshotListPage from "../page"

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const SNAPSHOTS = [
  {
    id: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW", sequenceNumber: 1,
    originalFilename: "import.csv", rowCount: 12, createdAt: "2026-07-01T00:00:00.000Z",
  },
]

function renderPage() {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/imports/snapshots?")) return mockResponse({ snapshots: SNAPSHOTS, count: 1, limit: 20, offset: 0 })
    throw new Error(`Unexpected fetch: ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/imports/snapshots"]}>
        <Routes>
          <Route path="/imports/snapshots" element={<ImportsSnapshotListPage />} />
          <Route path="/imports/snapshots/:id" element={<div>Snapshot detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { fetchMock }
}

describe("ImportsSnapshotListPage", () => {
  it("renders the snapshot list and navigates to the detail page on row click", async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText("import.csv")).toBeInTheDocument()
    expect(screen.getByText("PENDING_REVIEW")).toBeInTheDocument()

    await user.click(screen.getByText("import.csv"))
    expect(await screen.findByText("Snapshot detail page")).toBeInTheDocument()
  })
})
