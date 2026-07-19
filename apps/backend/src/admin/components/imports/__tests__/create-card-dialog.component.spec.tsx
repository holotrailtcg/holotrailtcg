/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import CreateCardDialog from "../create-card-dialog"
import type { InventoryProposalListItem, SnapshotEntryListResponse } from "../pulse-import-types"

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function baseRow(overrides: Partial<InventoryProposalListItem> = {}): InventoryProposalListItem {
  return {
    id: "tciprop_1", inventorySourceId: "tcisrc_1", inventorySnapshotId: "tcisnap_1", tradingCardVariantId: null,
    card: null, cardIdentityHint: "Gengar 066/196", providerReference: "provider-ref-1",
    previousQuantity: null, proposedQuantity: 1, quantityDelta: null, changeKind: "UNRESOLVED_VARIANT",
    reviewStatus: "PENDING", resolvedBy: null, resolvedAt: null, reviewNote: null, appliedAt: null,
    appliedTransactionId: null, medusaSyncStatus: "NOT_APPLICABLE", medusaInventoryItemId: null,
    medusaStockLocationId: null, medusaSyncRetryCount: 0, medusaSyncLastError: null, createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function entryListResponse(overrides: Partial<SnapshotEntryListResponse["entries"][number]> = {}): SnapshotEntryListResponse {
  return {
    entries: [{
      id: "tcisentry_1", rowNumber: 1, providerReference: "provider-ref-1", quantity: 1,
      currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
      conditionSource: "EXPLICIT", finishCandidate: "HOLO", specialTreatmentCandidate: "NONE",
      rarityCandidate: null, rarityRaw: null, languageConflict: false, outcome: "VALID",
      tradingCardVariantId: null, matchingStatus: "UNMATCHED", matchedVia: "NONE", retryCount: 0,
      ...overrides,
    }],
    count: 1, limit: 1, offset: 0,
  }
}

function renderDialog(fetchImpl: (url: string) => Promise<unknown>, rowOverrides: Partial<InventoryProposalListItem> = {}) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => fetchImpl(String(input)))
  global.fetch = fetchMock as unknown as typeof fetch
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = jest.fn()
  const onCreated = jest.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <CreateCardDialog row={baseRow(rowOverrides)} onClose={onClose} onCreated={onCreated} />
    </QueryClientProvider>
  )
  return { fetchMock, onClose, onCreated }
}

describe("CreateCardDialog — finish/special treatment confirmation (Codex remediation)", () => {
  it("prefills finish and special treatment from the import but leaves both unconfirmed, disabling Create", async () => {
    renderDialog(async (url) => {
      if (url.includes("/entries")) return mockResponse(entryListResponse())
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const finishSelect = await screen.findByLabelText("Finish") as HTMLSelectElement
    await waitFor(() => expect(finishSelect.value).toBe("HOLO"))
    const specialSelect = screen.getByLabelText("Special treatment") as HTMLSelectElement
    expect(specialSelect.value).toBe("NONE")

    const finishConfirm = screen.getByLabelText(/confirm this finish is correct/i) as HTMLInputElement
    const specialConfirm = screen.getByLabelText(/confirm this special treatment is correct/i) as HTMLInputElement
    expect(finishConfirm.checked).toBe(false)
    expect(specialConfirm.checked).toBe(false)

    expect(screen.getByRole("button", { name: "Create card" })).toBeDisabled()
  })

  it("lets the reviewer confirm a prefilled value without changing it, via the checkbox", async () => {
    const user = userEvent.setup()
    renderDialog(async (url) => {
      if (url.includes("/entries")) return mockResponse(entryListResponse())
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const finishSelect = await screen.findByLabelText("Finish") as HTMLSelectElement
    await waitFor(() => expect(finishSelect.value).toBe("HOLO"))

    const finishConfirm = screen.getByLabelText(/confirm this finish is correct/i) as HTMLInputElement
    await user.click(finishConfirm)
    expect(finishConfirm.checked).toBe(true)
    // The value itself was never touched — confirming does not change it.
    expect(finishSelect.value).toBe("HOLO")
  })

  it("resets confirmation when a confirmed value is changed to something else", async () => {
    const user = userEvent.setup()
    renderDialog(async (url) => {
      if (url.includes("/entries")) return mockResponse(entryListResponse())
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const finishSelect = await screen.findByLabelText("Finish") as HTMLSelectElement
    await waitFor(() => expect(finishSelect.value).toBe("HOLO"))
    const finishConfirm = screen.getByLabelText(/confirm this finish is correct/i) as HTMLInputElement

    await user.click(finishConfirm)
    expect(finishConfirm.checked).toBe(true)

    await user.selectOptions(finishSelect, "REVERSE_HOLO")
    expect(finishSelect.value).toBe("REVERSE_HOLO")
    expect(finishConfirm.checked).toBe(false)
  })

  it("enables Create only once every required field is filled and both confirmations are checked", async () => {
    const user = userEvent.setup()
    renderDialog(async (url) => {
      if (url.includes("/entries")) return mockResponse(entryListResponse())
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const createButton = screen.getByRole("button", { name: "Create card" })
    expect(createButton).toBeDisabled()

    await user.type(screen.getByLabelText("Set name"), "Lost Origin")
    await user.type(screen.getByLabelText("Card name"), "Gengar")
    await user.type(screen.getByLabelText("Card number"), "066/196")
    await user.selectOptions(screen.getByLabelText("Condition"), "NEAR_MINT")
    expect(createButton).toBeDisabled()

    const finishSelect = await screen.findByLabelText("Finish") as HTMLSelectElement
    await waitFor(() => expect(finishSelect.value).toBe("HOLO"))
    const specialSelect = screen.getByLabelText("Special treatment") as HTMLSelectElement
    expect(specialSelect.value).toBe("NONE")

    // Only the finish is confirmed so far — still disabled.
    await user.click(screen.getByLabelText(/confirm this finish is correct/i))
    expect(createButton).toBeDisabled()

    // Confirming special treatment too finally enables it.
    await user.click(screen.getByLabelText(/confirm this special treatment is correct/i))
    expect(createButton).toBeEnabled()
  })

  it("never submits an unconfirmed prefilled value even if the button is somehow triggered", async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderDialog(async (url) => {
      if (url.includes("/entries")) return mockResponse(entryListResponse())
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await user.type(screen.getByLabelText("Set name"), "Lost Origin")
    await user.type(screen.getByLabelText("Card name"), "Gengar")
    await user.type(screen.getByLabelText("Card number"), "066/196")
    await user.selectOptions(screen.getByLabelText("Condition"), "NEAR_MINT")
    await screen.findByDisplayValue("Holo")

    const createButton = screen.getByRole("button", { name: "Create card" })
    expect(createButton).toBeDisabled()
    // A disabled button's click handler must not fire — no request is ever made.
    await user.click(createButton)
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/create-from-inventory-row"), expect.anything()
    )
  })
})
