import {
  extractClientAddress,
  resolveTrustedProxyConfig,
  type ClientAddressContext,
} from "../client-address"

describe("resolveTrustedProxyConfig", () => {
  it("defaults to not trusting a proxy header", () => {
    const config = resolveTrustedProxyConfig({})
    expect(config.trustProxy).toBe(false)
    expect(config.trustedHeaderName).toBeUndefined()
  })

  it("throws if NEWSLETTER_TRUST_PROXY=true without a header name (production cannot half-configure trust)", () => {
    expect(() => resolveTrustedProxyConfig({ NEWSLETTER_TRUST_PROXY: "true" })).toThrow()
  })

  it("enables header trust only when both variables are explicitly set", () => {
    const config = resolveTrustedProxyConfig({
      NEWSLETTER_TRUST_PROXY: "true",
      NEWSLETTER_TRUSTED_IP_HEADER: "x-newsletter-client-key",
    })
    expect(config.trustProxy).toBe(true)
    expect(config.trustedHeaderName).toBe("x-newsletter-client-key")
  })
})

describe("extractClientAddress — direct socket address (default, untrusted proxy)", () => {
  const untrusted = { trustProxy: false }

  it("trusts the direct socket remote address", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "203.0.113.5",
      headers: {},
    }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: true, address: "203.0.113.5" })
  })

  it("ignores an arbitrary x-forwarded-for header when proxy trust is disabled", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "203.0.113.5",
      headers: { "x-forwarded-for": "198.51.100.9" },
    }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: true, address: "203.0.113.5" })
  })

  it("fails closed when no socket address is present", () => {
    const context: ClientAddressContext = { socketRemoteAddress: null, headers: {} }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: false, reason: "NO_ADDRESS" })
  })

  it("rejects a malformed socket address", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "not-an-ip",
      headers: {},
    }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: false, reason: "MALFORMED_ADDRESS" })
  })
})

describe("extractClientAddress — trusted configured header", () => {
  const trusted = { trustProxy: true, trustedHeaderName: "x-newsletter-client-key" }

  it("trusts the configured header when proxy trust is explicitly enabled", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "10.0.0.1",
      headers: { "x-newsletter-client-key": "203.0.113.7" },
    }
    const result = extractClientAddress(context, trusted)
    expect(result).toEqual({ ok: true, address: "203.0.113.7" })
  })

  it("rejects a multi-value (array) header", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "10.0.0.1",
      headers: { "x-newsletter-client-key": ["203.0.113.7", "203.0.113.8"] },
    }
    const result = extractClientAddress(context, trusted)
    expect(result).toEqual({ ok: false, reason: "MULTI_VALUE_HEADER" })
  })

  it("rejects a comma-separated forwarding chain in the trusted header", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "10.0.0.1",
      headers: { "x-newsletter-client-key": "203.0.113.7, 70.41.3.18" },
    }
    const result = extractClientAddress(context, trusted)
    expect(result).toEqual({ ok: false, reason: "MULTI_VALUE_HEADER" })
  })

  it("fails closed when the trusted header is absent", () => {
    const context: ClientAddressContext = { socketRemoteAddress: "10.0.0.1", headers: {} }
    const result = extractClientAddress(context, trusted)
    expect(result).toEqual({ ok: false, reason: "NO_ADDRESS" })
  })

  it("does not fall back to the socket address when header trust is enabled but empty", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "203.0.113.99",
      headers: { "x-newsletter-client-key": "not-an-ip" },
    }
    const result = extractClientAddress(context, trusted)
    expect(result).toEqual({ ok: false, reason: "MALFORMED_ADDRESS" })
  })
})

describe("extractClientAddress — normalisation", () => {
  const untrusted = { trustProxy: false }

  it("strips brackets and a port from a bracketed IPv6 literal", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "[2001:db8::1]:54321",
      headers: {},
    }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: true, address: "2001:db8::1" })
  })

  it("strips an IPv6 zone id", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "fe80::1%eth0",
      headers: {},
    }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: true, address: "fe80::1" })
  })

  it("canonicalises an IPv4-mapped IPv6 address to plain IPv4", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "::ffff:203.0.113.5",
      headers: {},
    }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: true, address: "203.0.113.5" })
  })

  it("lower-cases an IPv6 address", () => {
    const context: ClientAddressContext = {
      socketRemoteAddress: "2001:DB8::1",
      headers: {},
    }
    const result = extractClientAddress(context, untrusted)
    expect(result).toEqual({ ok: true, address: "2001:db8::1" })
  })
})
