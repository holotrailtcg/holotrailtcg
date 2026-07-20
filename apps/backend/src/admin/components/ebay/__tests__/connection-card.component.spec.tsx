/** @jest-environment jsdom */
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import ConnectionCard from "../connection-card"

const mockPrompt = jest.fn()
jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui")
  return { ...actual, usePrompt: () => mockPrompt }
})

const base = {
  environment: "SANDBOX" as const,
  configured: true,
  reconnectRequired: false,
  connection: null,
}

describe("eBay connection card", () => {
  beforeEach(() => mockPrompt.mockReset().mockResolvedValue(true))
  it("states that connecting cannot publish listings", () => {
    render(<ConnectionCard value={base} busy={false} onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect(screen.getByText(/does not create, revise or publish/)).toBeInTheDocument()
  })

  it("requires a Production confirmation before connecting", async () => {
    const onConnect = jest.fn().mockResolvedValue(undefined)
    render(<ConnectionCard value={{ ...base, environment: "PRODUCTION" }} busy={false} onConnect={onConnect} onDisconnect={jest.fn()} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Connect" }))
    expect(onConnect).toHaveBeenCalledWith(false)
    expect(mockPrompt).toHaveBeenCalledWith(expect.objectContaining({
      title: "Connect eBay Production?", description: expect.stringContaining("live seller account"),
    }))
  })

  it("does not connect when Production confirmation is cancelled", async () => {
    mockPrompt.mockResolvedValueOnce(false)
    const onConnect = jest.fn()
    render(<ConnectionCard value={{ ...base, environment: "PRODUCTION" }} busy={false} onConnect={onConnect} onDisconnect={jest.fn()} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Connect" }))
    expect(onConnect).not.toHaveBeenCalled()
  })

  it("shows safe account state without any token fields", () => {
    const connection = {
      id: "ebconn_1", environment: "SANDBOX" as const, ebayAccountId: "immutable-id", displayName: "Seller",
      status: "CONNECTED" as const, grantedScopes: ["identity"], connectedAt: "2026-07-20T10:00:00Z",
      disconnectedAt: null, lastRefreshAt: "2026-07-20T10:01:00Z", lastSafeErrorCategory: null,
    }
    const { container } = render(<ConnectionCard value={{ ...base, connection }} busy={false} onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect(screen.getByText("Seller")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/refresh.token|ciphertext|auth.tag/i)
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled()
  })

  it.each(["SANDBOX", "PRODUCTION"] as const)("does not disconnect %s when confirmation is cancelled", async (environment) => {
    mockPrompt.mockResolvedValueOnce(false)
    const onDisconnect = jest.fn()
    const connection = {
      id: "ebconn_1", environment, ebayAccountId: "immutable-id", displayName: "Seller",
      status: "CONNECTED" as const, grantedScopes: [], connectedAt: null,
      disconnectedAt: null, lastRefreshAt: null, lastSafeErrorCategory: null,
    }
    render(<ConnectionCard value={{ ...base, environment, connection }} busy={false} onConnect={jest.fn()} onDisconnect={onDisconnect} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Disconnect" }))
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(mockPrompt).toHaveBeenCalledWith(expect.objectContaining({
      title: `Disconnect eBay ${environment === "PRODUCTION" ? "Production" : "Sandbox"}?`,
      description: expect.stringContaining("locally usable credential"),
    }))
  })

  it("explains that a transient degraded state does not require renewed consent", () => {
    const connection = {
      id: "ebconn_1", environment: "SANDBOX" as const, ebayAccountId: "immutable-id", displayName: "Seller",
      status: "DEGRADED" as const, grantedScopes: [], connectedAt: null,
      disconnectedAt: null, lastRefreshAt: null, lastSafeErrorCategory: "REMOTE_UNAVAILABLE",
    }
    render(<ConnectionCard value={{ ...base, connection, reconnectRequired: false }} busy={false} onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect(screen.getByText("Connected with issue")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(/renewed consent is not currently required/i)
  })

  it("explains a cancelled reconnect while retaining the saved authorisation", () => {
    const connection = {
      id: "ebconn_1", environment: "SANDBOX" as const, ebayAccountId: "immutable-id", displayName: "Seller",
      status: "DEGRADED" as const, grantedScopes: [], connectedAt: null,
      disconnectedAt: null, lastRefreshAt: null, lastSafeErrorCategory: "USER_DENIED",
    }
    render(<ConnectionCard value={{ ...base, connection, reconnectRequired: false }} busy={false} onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect(screen.getByText("Connected with issue")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(/latest reconnect was cancelled/i)
    expect(screen.getByRole("alert")).toHaveTextContent(/saved authorisation is retained/i)
  })

  it("offers a recoverable retry while disconnecting", async () => {
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const connection = {
      id: "ebconn_1", environment: "SANDBOX" as const, ebayAccountId: "immutable-id", displayName: "Seller",
      status: "DISCONNECTING" as const, grantedScopes: [], connectedAt: null,
      disconnectedAt: null, lastRefreshAt: null, lastSafeErrorCategory: null,
    }
    render(<ConnectionCard value={{ ...base, connection }} busy={false} onConnect={jest.fn()} onDisconnect={onDisconnect} />)
    const retry = screen.getByRole("button", { name: "Retry disconnect" })
    expect(retry).toBeEnabled()
    await userEvent.setup().click(retry)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it.each(["REFRESH_REQUIRED", "REVOKED"] as const)("requires renewed consent for %s", (status) => {
    const connection = {
      id: "ebconn_1", environment: "SANDBOX" as const, ebayAccountId: "immutable-id", displayName: "Seller",
      status, grantedScopes: [], connectedAt: null, disconnectedAt: null, lastRefreshAt: null,
      lastSafeErrorCategory: status === "REFRESH_REQUIRED" ? "REFRESH_REQUIRED" : null,
    }
    render(<ConnectionCard value={{ ...base, connection, reconnectRequired: true }} busy={false} onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect(screen.getByRole("alert")).toHaveTextContent(/renewed eBay consent is required/i)
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled()
  })
})
