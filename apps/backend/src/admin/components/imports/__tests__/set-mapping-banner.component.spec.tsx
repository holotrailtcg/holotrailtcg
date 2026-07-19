/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import SetMappingBanner from "../set-mapping-banner"

jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui")
  return { ...actual, toast: { ...actual.toast, success: jest.fn(), error: jest.fn() } }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedUi = jest.requireMock("@medusajs/ui") as { toast: { success: jest.Mock; error: jest.Mock } }

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderBanner(fetchMock: jest.Mock) {
  global.fetch = fetchMock as unknown as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SetMappingBanner snapshotId="tcisnap_1" />
    </QueryClientProvider>
  )
}

describe("SetMappingBanner", () => {
  beforeEach(() => {
    mockedUi.toast.success.mockClear()
    mockedUi.toast.error.mockClear()
  })

  it("renders nothing when there are no unmapped set codes", async () => {
    const fetchMock = jest.fn(async () => mockResponse({ language: "EN", unmappedSetCodes: [] }))
    global.fetch = fetchMock as unknown as typeof fetch
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SetMappingBanner snapshotId="tcisnap_1" />
      </QueryClientProvider>
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("shows one button per unmapped set code", async () => {
    const fetchMock = jest.fn(async () => mockResponse({ language: "EN", unmappedSetCodes: ["swsh4pt5", "wc23cl"] }))
    renderBanner(fetchMock)

    expect(await screen.findByText(/2 sets need mapping/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: 'Map "swsh4pt5"' })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: 'Map "wc23cl"' })).toBeInTheDocument()
  })

  it("opens the confirm dialog, shows a suggested candidate, and confirms it", async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (method === "POST" && url.includes("/provider-set-mappings")) {
        return mockResponse({ mapping: { id: "tcpsm_1" } }, 201)
      }
      if (url.includes("/provider-set-mappings/suggest")) {
        return mockResponse({ candidates: [{ id: "swsh4.5", name: "Shining Fates" }], sets: [] })
      }
      if (url.includes("/provider-set-mappings/unmapped")) {
        return mockResponse({ language: "EN", unmappedSetCodes: ["swsh4pt5"] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    renderBanner(fetchMock)

    await user.click(await screen.findByRole("button", { name: 'Map "swsh4pt5"' }))
    expect(await screen.findByRole("heading", { name: 'Map "swsh4pt5" to a TCGdex set' })).toBeInTheDocument()

    const candidateButton = await screen.findByRole("button", { name: "Shining Fates (swsh4.5)" })
    await user.click(candidateButton)

    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalled())
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(postCall).toBeDefined()
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toMatchObject({
      provider: "PULSE", game: "POKEMON", language: "EN", providerSetCode: "swsh4pt5", tcgdexSetId: "swsh4.5",
    })
  })

  it("lets the reviewer search the full TCGdex set list and confirm a result", async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (method === "POST" && url.includes("/provider-set-mappings")) {
        return mockResponse({ mapping: { id: "tcpsm_1" } }, 201)
      }
      if (url.includes("/provider-set-mappings/suggest")) {
        return mockResponse({
          candidates: [],
          sets: [{ id: "cbb2c", name: "Gem Pack Vol. 2" }, { id: "cbb4c", name: "Gem Pack Vol. 4" }],
        })
      }
      if (url.includes("/provider-set-mappings/unmapped")) {
        return mockResponse({ language: "ZH", unmappedSetCodes: ["cbb2_scn"] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    renderBanner(fetchMock)

    await user.click(await screen.findByRole("button", { name: 'Map "cbb2_scn"' }))
    await screen.findByRole("heading", { name: 'Map "cbb2_scn" to a TCGdex set' })

    await user.type(screen.getByLabelText("Search TCGdex sets"), "gem pack vol. 2")
    expect(await screen.findByRole("button", { name: "Gem Pack Vol. 2 (cbb2c)" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Gem Pack Vol. 4 (cbb4c)" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Gem Pack Vol. 2 (cbb2c)" }))
    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalled())
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toMatchObject({ tcgdexSetId: "cbb2c" })
  })

  it("lets the reviewer type a TCGdex id directly when no candidate is suggested", async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (method === "POST" && url.includes("/provider-set-mappings")) {
        return mockResponse({ mapping: { id: "tcpsm_1" } }, 201)
      }
      if (url.includes("/provider-set-mappings/suggest")) {
        return mockResponse({ candidates: [], sets: [] })
      }
      if (url.includes("/provider-set-mappings/unmapped")) {
        return mockResponse({ language: "EN", unmappedSetCodes: ["wc23cl"] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    renderBanner(fetchMock)

    await user.click(await screen.findByRole("button", { name: 'Map "wc23cl"' }))
    await screen.findByRole("heading", { name: 'Map "wc23cl" to a TCGdex set' })

    expect(screen.getByRole("button", { name: "Confirm mapping" })).toBeDisabled()
    await user.type(screen.getByLabelText("TCGdex set id"), "wc23cl-lugia")
    expect(screen.getByRole("button", { name: "Confirm mapping" })).not.toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Confirm mapping" }))
    await waitFor(() => expect(mockedUi.toast.success).toHaveBeenCalled())
  })
})
