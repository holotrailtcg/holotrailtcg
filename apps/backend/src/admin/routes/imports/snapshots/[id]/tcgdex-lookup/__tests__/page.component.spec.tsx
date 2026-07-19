/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import ImportsTcgdexLookupPage from "../page"

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderPage(progressSequence: Array<Record<string, number>>) {
  let call = 0
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method === "POST" && url.includes("/tcgdex-lookup/process-batch")) {
      const progress = progressSequence[Math.min(call, progressSequence.length - 1)]
      call += 1
      return mockResponse({ progress })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch

  render(
    <MemoryRouter initialEntries={["/imports/snapshots/tcisnap_1/tcgdex-lookup"]}>
      <Routes>
        <Route path="/imports/snapshots/:id/tcgdex-lookup" element={<ImportsTcgdexLookupPage />} />
        <Route path="/imports/snapshots/:id" element={<div>Snapshot detail</div>} />
      </Routes>
    </MemoryRouter>
  )
  return { fetchMock }
}

describe("ImportsTcgdexLookupPage", () => {
  it("shows progress from each batch while looking up is still in progress", async () => {
    let resolveFirstBatch: (value: unknown) => void = () => undefined
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (method === "POST" && url.includes("/tcgdex-lookup/process-batch")) {
        return new Promise((resolve) => { resolveFirstBatch = resolve })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch
    render(
      <MemoryRouter initialEntries={["/imports/snapshots/tcisnap_1/tcgdex-lookup"]}>
        <Routes>
          <Route path="/imports/snapshots/:id/tcgdex-lookup" element={<ImportsTcgdexLookupPage />} />
          <Route path="/imports/snapshots/:id" element={<div>Snapshot detail</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText("Starting — checking how many cards need looking up…")).toBeInTheDocument()
    resolveFirstBatch(mockResponse({
      progress: { totalCandidates: 25, needsSetMappingCount: 0, cachedCount: 0, processedThisBatch: 10, remaining: 15 },
    }))
    expect(await screen.findByText(/10 of 25 cards checked/)).toBeInTheDocument()
  })

  it("polls process-batch until nothing remains, then moves on to the snapshot detail page", async () => {
    renderPage([
      { totalCandidates: 25, needsSetMappingCount: 0, cachedCount: 0, processedThisBatch: 10, remaining: 15 },
      { totalCandidates: 25, needsSetMappingCount: 0, cachedCount: 10, processedThisBatch: 10, remaining: 5 },
      { totalCandidates: 25, needsSetMappingCount: 0, cachedCount: 20, processedThisBatch: 5, remaining: 0 },
    ])

    expect(await screen.findByText("Snapshot detail")).toBeInTheDocument()
  })

  it("moves on immediately when there is nothing to look up", async () => {
    renderPage([{ totalCandidates: 0, needsSetMappingCount: 0, cachedCount: 0, processedThisBatch: 0, remaining: 0 }])
    expect(await screen.findByText("Snapshot detail")).toBeInTheDocument()
  })

  it("reports how many rows were skipped for needing a set mapping", async () => {
    renderPage([{ totalCandidates: 5, needsSetMappingCount: 3, cachedCount: 0, processedThisBatch: 5, remaining: 0 }])
    await waitFor(() => expect(screen.getByText("Snapshot detail")).toBeInTheDocument())
  })

  it("shows an error and a manual continue button if a batch call fails", async () => {
    const fetchMock = jest.fn(async () => mockResponse({ error: "boom" }, 500))
    global.fetch = fetchMock as unknown as typeof fetch
    render(
      <MemoryRouter initialEntries={["/imports/snapshots/tcisnap_1/tcgdex-lookup"]}>
        <Routes>
          <Route path="/imports/snapshots/:id/tcgdex-lookup" element={<ImportsTcgdexLookupPage />} />
          <Route path="/imports/snapshots/:id" element={<div>Snapshot detail</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed/i)
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument()
  })
})
