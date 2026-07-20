import {
  ebayConnectionsEnabled, hasEbayEnvironmentConfig, resolveEbayEnvironmentConfig,
} from "../config"

const sandbox = {
  EBAY_CONNECTIONS_ENABLED: "true",
  EBAY_SANDBOX_CLIENT_ID: "sandbox-client",
  EBAY_SANDBOX_CLIENT_SECRET: "sandbox-secret",
  EBAY_SANDBOX_REDIRECT_URI: "sandbox-runame",
}

describe("eBay environment configuration", () => {
  it("is fail-closed unless explicitly enabled", () => {
    expect(ebayConnectionsEnabled({} as NodeJS.ProcessEnv)).toBe(false)
    expect(ebayConnectionsEnabled({ EBAY_CONNECTIONS_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false)
    expect(ebayConnectionsEnabled(sandbox as NodeJS.ProcessEnv)).toBe(true)
  })

  it("keeps Sandbox and Production values isolated", () => {
    const config = resolveEbayEnvironmentConfig("SANDBOX", sandbox as NodeJS.ProcessEnv)
    expect(config.clientId).toBe("sandbox-client")
    expect(config.authorisationUrl).toBe("https://auth.sandbox.ebay.com/oauth2/authorize")
    expect(config.tokenUrl).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token")
    expect(hasEbayEnvironmentConfig("PRODUCTION", sandbox as NodeJS.ProcessEnv)).toBe(false)
    expect(() => resolveEbayEnvironmentConfig("PRODUCTION", sandbox as NodeJS.ProcessEnv)).toThrow("production")
  })

  it("never includes a missing credential value in its public error", () => {
    const marker = "SHOULD_NEVER_APPEAR"
    let message = ""
    try {
      resolveEbayEnvironmentConfig("SANDBOX", {
        ...sandbox, EBAY_SANDBOX_CLIENT_ID: marker, EBAY_SANDBOX_CLIENT_SECRET: "",
      } as NodeJS.ProcessEnv)
    } catch (error) {
      message = String(error)
    }
    expect(message).not.toContain(marker)
  })

  it("reports configured only when the complete bounded contract validates", () => {
    expect(hasEbayEnvironmentConfig("SANDBOX", sandbox as NodeJS.ProcessEnv)).toBe(true)
    expect(hasEbayEnvironmentConfig("SANDBOX", {
      ...sandbox, EBAY_SANDBOX_CLIENT_ID: "x".repeat(256),
    } as NodeJS.ProcessEnv)).toBe(false)
  })
})
