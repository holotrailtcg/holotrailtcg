import {
  buildEbayAuthorisationUrl, exchangeAuthorisationCode, EbayRemoteError, revokeRefreshToken,
} from "../oauth/client"
import { generateOAuthState, hashOAuthState } from "../oauth/state"
import { ebayAuthorisationTokenResponseSchema, ebayRefreshTokenResponseSchema } from "../oauth/schemas"
import {
  EBAY_E1_SCOPES, EBAY_MAX_REMOTE_RESPONSE_BYTES, resolveEbayGrantedScopes,
} from "../types"
import type { EbayEnvironmentConfig } from "../config"

const config: EbayEnvironmentConfig = {
  environment: "SANDBOX",
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "ru-name",
  authorisationUrl: "https://auth.sandbox.ebay.com/oauth2/authorize",
  tokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  revokeUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token/revoke",
  identityUrl: "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/",
}

describe("eBay OAuth primitives", () => {
  afterEach(() => jest.restoreAllMocks())

  it("uses the requested E1 scopes when eBay omits scope from a token response", () => {
    expect(resolveEbayGrantedScopes(undefined)).toEqual([...EBAY_E1_SCOPES])
    expect(resolveEbayGrantedScopes("scope:a scope:b")).toEqual(["scope:a", "scope:b"])
  })

  it("generates at least 256 random bits and stores only a SHA-256 hash", () => {
    const first = generateOAuthState()
    const second = generateOAuthState()
    expect(first).not.toBe(second)
    expect(Buffer.from(first, "base64url")).toHaveLength(32)
    expect(hashOAuthState(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashOAuthState(first)).not.toContain(first)
  })

  it("builds the fixed-environment consent URL with only E1 scopes", () => {
    const url = new URL(buildEbayAuthorisationUrl(config, "state-value"))
    expect(url.origin).toBe("https://auth.sandbox.ebay.com")
    expect(url.searchParams.get("client_id")).toBe("client-id")
    expect(url.searchParams.get("redirect_uri")).toBe("ru-name")
    expect(url.searchParams.get("state")).toBe("state-value")
    expect(url.searchParams.get("scope")).toContain("commerce.identity.readonly")
    expect(url.searchParams.get("scope")).not.toContain("sell.inventory")
  })

  it("strictly validates token responses", () => {
    expect(ebayAuthorisationTokenResponseSchema.safeParse({
      access_token: "a", refresh_token: "r", expires_in: "7200", token_type: "User Access Token",
    }).success).toBe(false)
    expect(ebayAuthorisationTokenResponseSchema.safeParse({
      access_token: "a", refresh_token: "r", expires_in: 7200, token_type: "Bearer",
    }).success).toBe(false)
    const refreshed = ebayRefreshTokenResponseSchema.parse({
      access_token: "a", refresh_token: "UNDOCUMENTED", expires_in: 7200, token_type: "User Access Token",
    })
    expect(refreshed).not.toHaveProperty("refresh_token")
  })

  it("classifies bounded remote errors without exposing secret-shaped values", async () => {
    const marker = "SECRET_CODE_SENTINEL"
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: marker }), { status: 400 }))
    let serialised = ""
    try {
      await exchangeAuthorisationCode(config, marker, "correlation-id")
    } catch (error) {
      expect(error).toBeInstanceOf(EbayRemoteError)
      serialised = JSON.stringify(error, Object.getOwnPropertyNames(error as object))
    }
    expect(serialised).not.toContain(marker)
    expect(serialised).toContain("REFRESH_REQUIRED")
  })

  it("rejects oversized and malformed success bodies", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("x".repeat(70_000), { status: 200 }))
    await expect(exchangeAuthorisationCode(config, "code")).rejects.toMatchObject({ category: "INVALID_REMOTE_RESPONSE" })
  })

  it("accepts a valid body below the response limit", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "a", refresh_token: "r", expires_in: 7200, token_type: "User Access Token",
    }), { status: 200 }))
    await expect(exchangeAuthorisationCode(config, "code")).resolves.toMatchObject({
      token: { access_token: "a", refresh_token: "r", expires_in: 7200 },
    })
  })

  it("accepts a bounded body at the exact limit and strips unknown fields", async () => {
    const base = { access_token: "a", refresh_token: "r", expires_in: 7200, token_type: "User Access Token", padding: "" }
    const initial = JSON.stringify(base)
    base.padding = "x".repeat(EBAY_MAX_REMOTE_RESPONSE_BYTES - Buffer.byteLength(initial))
    const body = JSON.stringify(base)
    expect(Buffer.byteLength(body)).toBe(EBAY_MAX_REMOTE_RESPONSE_BYTES)
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(body, { status: 200 }))
    await expect(exchangeAuthorisationCode(config, "code")).resolves.toMatchObject({
      token: { access_token: "a", refresh_token: "r" },
    })
  })

  it("rejects excessive Content-Length before reading", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("{}", {
      status: 200, headers: { "Content-Length": String(EBAY_MAX_REMOTE_RESPONSE_BYTES + 1) },
    }))
    await expect(exchangeAuthorisationCode(config, "code")).rejects.toMatchObject({ category: "INVALID_REMOTE_RESPONSE" })
  })

  it("classifies a non-JSON 5xx by HTTP status", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("temporarily unavailable", { status: 503 }))
    await expect(exchangeAuthorisationCode(config, "code")).rejects.toMatchObject({ category: "REMOTE_UNAVAILABLE" })
  })

  it("accepts an empty successful revocation response", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }))
    await expect(revokeRefreshToken(config, "refresh-token")).resolves.toHaveProperty("correlationId")
  })
})
