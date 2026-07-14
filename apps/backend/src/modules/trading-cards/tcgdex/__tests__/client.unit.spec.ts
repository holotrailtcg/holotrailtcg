import { TcgDexClient } from "../client"
import { DEFAULT_TCGDEX_CONFIG, loadTcgDexConfig, type TcgDexConfig } from "../config"
import { TCGDEX_ERROR_CODE, TcgDexError } from "../errors"
import { mapTcgDexLanguage } from "../language"
import type { TcgDexFetch } from "../types"

const config: TcgDexConfig = {
  ...DEFAULT_TCGDEX_CONFIG,
  maxRetries: 3,
  retryBaseDelayMs: 10,
  retryMaxDelayMs: 25,
  maxResponseBytes: 10_000,
}

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })

const responseWithBody = (body: ReadableStream<Uint8Array>) => ({
  ok: true,
  status: 200,
  headers: new Headers({ "Content-Type": "application/json" }),
  body,
}) as unknown as Response

const validCard = (overrides: Record<string, unknown> = {}) => ({
  category: "Pokemon",
  id: "sv06-1",
  localId: "1",
  name: "Sneasel",
  image: "https://assets.tcgdex.net/en/sv/sv06/1",
  illustrator: "Artist",
  rarity: "Common",
  set: { id: "sv06", name: "Twilight Masquerade" },
  variants: { normal: true, reverse: true, holo: false, firstEdition: false },
  ...overrides,
})

function makeClient(fetchImpl: TcgDexFetch, sleep = jest.fn(async () => undefined)) {
  return { client: new TcgDexClient(config, { fetchImpl, sleep }), sleep }
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code })
}

describe("TCGdex language mapping", () => {
  it("maps all supported languages explicitly", () => {
    expect(mapTcgDexLanguage("EN")).toBe("en")
    expect(mapTcgDexLanguage("JA")).toBe("ja")
    expect(mapTcgDexLanguage("ZH")).toBe("zh-tw")
  })

  it("rejects arbitrary languages", () => {
    expect(() => mapTcgDexLanguage("FR")).toThrow(TcgDexError)
    expect(() => mapTcgDexLanguage("FR")).toThrow(expect.objectContaining({ code: TCGDEX_ERROR_CODE.INVALID_REQUEST }))
  })
})

describe("TcgDexClient", () => {
  it.each([
    ["EN", "en"],
    ["JA", "ja"],
    ["ZH", "zh-tw"],
  ] as const)("validates a %s card response", async (language, apiLanguage) => {
    const fetchImpl = jest.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`https://api.tcgdex.net/v2/${apiLanguage}/sets/sv06/1`)
      return response(validCard())
    })
    const { client } = makeClient(fetchImpl)
    await expect(client.getCardBySetAndLocalId(language, "sv06", "1")).resolves.toMatchObject({ id: "sv06-1" })
  })

  it("accepts documented optional fields being absent and non-Pokemon fields", async () => {
    const fetchImpl = jest.fn(async () => response(validCard({
      category: "Trainer",
      image: undefined,
      illustrator: undefined,
      rarity: undefined,
      effect: "Draw a card.",
      trainerType: "Supporter",
    })))
    const { client } = makeClient(fetchImpl)
    await expect(client.getCardById("EN", "sv06-1")).resolves.toMatchObject({ category: "Trainer", effect: "Draw a card." })
  })

  it("validates an Energy response", async () => {
    const fetchImpl = jest.fn(async () => response(validCard({
      category: "Energy",
      image: undefined,
      illustrator: undefined,
      rarity: undefined,
      energyType: "Basic",
      effect: "Provides energy.",
    })))
    const { client } = makeClient(fetchImpl)
    await expect(client.getCardById("EN", "sv06-1")).resolves.toMatchObject({ category: "Energy", energyType: "Basic" })
  })

  it("validates nested structures and required identity fields", async () => {
    const fetchImpl = jest.fn(async () => response(validCard({ set: { id: "sv06" } })))
    const { client } = makeClient(fetchImpl)
    await expectCode(client.getCardById("EN", "sv06-1"), TCGDEX_ERROR_CODE.INVALID_RESPONSE)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("rejects empty identifiers without making a request", async () => {
    const fetchImpl = jest.fn(async () => response(validCard()))
    const { client } = makeClient(fetchImpl)
    await expectCode(client.getCardBySetAndLocalId("EN", "", "1"), TCGDEX_ERROR_CODE.INVALID_REQUEST)
    await expectCode(client.getCardById("EN", ""), TCGDEX_ERROR_CODE.INVALID_REQUEST)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("encodes path components safely", async () => {
    const fetchImpl = jest.fn(async (url: string | URL) => {
      expect(String(url)).toContain("/cards/a%2Fb%3Fc")
      return response(validCard())
    })
    const { client } = makeClient(fetchImpl)
    await client.getCardById("EN", "a/b?c")
  })

  it("does not retry a 404", async () => {
    const fetchImpl = jest.fn(async () => response({}, 404))
    const { client } = makeClient(fetchImpl)
    await expectCode(client.getCardById("EN", "missing"), TCGDEX_ERROR_CODE.NOT_FOUND)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("uses numeric Retry-After for a rate limit", async () => {
    const fetchImpl = jest.fn(async () => response({}, 429, { "Retry-After": "20" }))
    const { client, sleep } = makeClient(fetchImpl)
    await expectCode(client.getCardById("EN", "busy"), TCGDEX_ERROR_CODE.RATE_LIMITED)
    expect(sleep).toHaveBeenCalledWith(25)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it("uses HTTP-date Retry-After when it is safe", async () => {
    const now = Date.parse("2026-07-14T12:00:00.000Z")
    const fetchImpl = jest.fn(async () => response({}, 429, { "Retry-After": "Tue, 14 Jul 2026 12:00:01 GMT" }))
    const { client, sleep } = makeClient(fetchImpl)
    const configuredClient = new TcgDexClient({ ...config, retryMaxDelayMs: 4_000 }, { fetchImpl, sleep, now: () => now })
    await expectCode(configuredClient.getCardById("EN", "busy"), TCGDEX_ERROR_CODE.RATE_LIMITED)
    expect(sleep).toHaveBeenCalledWith(1_000)
  })

  it("falls back and caps malformed Retry-After", async () => {
    const fetchImpl = jest.fn(async () => response({}, 429, { "Retry-After": "not-a-delay" }))
    const { client, sleep } = makeClient(fetchImpl)
    await expectCode(client.getCardById("EN", "busy"), TCGDEX_ERROR_CODE.RATE_LIMITED)
    expect(sleep).toHaveBeenNthCalledWith(1, 10)
    expect(sleep).toHaveBeenNthCalledWith(3, 25)
  })

  it("retries a transient 5xx and succeeds", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(validCard()))
    const { client } = makeClient(fetchImpl)
    await expect(client.getCardById("EN", "sv06-1")).resolves.toMatchObject({ id: "sv06-1" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("classifies final 5xx after retries", async () => {
    const fetchImpl = jest.fn(async () => response({}, 500))
    const { client } = makeClient(fetchImpl)
    let error: unknown
    try { await client.getCardById("EN", "sv06-1") } catch (caught) { error = caught }
    expect(error).toMatchObject({ code: TCGDEX_ERROR_CODE.SERVER_ERROR, attemptCount: 4, status: 500 })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it("retries a timeout and succeeds", async () => {
    const abortError = new DOMException("aborted", "AbortError")
    const fetchImpl = jest.fn().mockRejectedValueOnce(abortError).mockResolvedValueOnce(response(validCard()))
    const { client } = makeClient(fetchImpl)
    await expect(client.getCardById("EN", "sv06-1")).resolves.toMatchObject({ id: "sv06-1" })
  })

  it("classifies timeout and network exhaustion", async () => {
    const timeoutFetch = jest.fn(async () => { throw new DOMException("aborted", "AbortError") })
    const networkFetch = jest.fn(async () => { throw new Error("socket closed") })
    await expectCode(makeClient(timeoutFetch).client.getCardById("EN", "sv06-1"), TCGDEX_ERROR_CODE.TIMEOUT)
    await expectCode(makeClient(networkFetch).client.getCardById("EN", "sv06-1"), TCGDEX_ERROR_CODE.NETWORK_ERROR)
  })

  it("does not retry malformed JSON or schema failures", async () => {
    const malformedFetch = jest.fn(async () => response("{"))
    const schemaFetch = jest.fn(async () => response({ nope: true }))
    const malformedClient = makeClient(malformedFetch).client
    const schemaClient = makeClient(schemaFetch).client
    await expectCode(malformedClient.getCardById("EN", "sv06-1"), TCGDEX_ERROR_CODE.INVALID_RESPONSE)
    await expectCode(schemaClient.getCardById("EN", "sv06-1"), TCGDEX_ERROR_CODE.INVALID_RESPONSE)
    expect(malformedFetch).toHaveBeenCalledTimes(1)
    expect(schemaFetch).toHaveBeenCalledTimes(1)
  })

  it("classifies a response.text failure as invalid without leaking its error", async () => {
    const providerSecret = "provider-secret-payload"
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => { throw new Error(providerSecret) },
    }) as unknown as Response)
    const { client } = makeClient(fetchImpl)
    let error: unknown
    try { await client.getCardById("EN", "sv06-1") } catch (caught) { error = caught }
    expect(error).toMatchObject({ code: TCGDEX_ERROR_CODE.INVALID_RESPONSE, attemptCount: 1 })
    expect(error).not.toMatchObject({ message: expect.stringContaining(providerSecret) })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["network", new Error("provider-body-secret")],
    ["timeout", new DOMException("provider-body-secret", "AbortError")],
  ] as const)("retries a body-read %s failure and succeeds", async (_kind, readError) => {
    const failingBody = new ReadableStream<Uint8Array>({ start(controller) { controller.error(readError) } })
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(responseWithBody(failingBody))
      .mockResolvedValueOnce(response(validCard()))
    const { client, sleep } = makeClient(fetchImpl)
    await expect(client.getCardById("EN", "sv06-1")).resolves.toMatchObject({ id: "sv06-1" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it("classifies exhausted body-read network failure", async () => {
    const fetchImpl = jest.fn(async () => responseWithBody(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("provider-body-secret")) },
    })))
    const { client, sleep } = makeClient(fetchImpl)
    let error: unknown
    try { await client.getCardById("EN", "sv06-1") } catch (caught) { error = caught }
    expect(error).toMatchObject({ code: TCGDEX_ERROR_CODE.NETWORK_ERROR, attemptCount: 4 })
    expect(error).not.toMatchObject({ message: expect.stringContaining("provider-body-secret") })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it("classifies exhausted body-read timeout", async () => {
    const fetchImpl = jest.fn(async () => responseWithBody(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new DOMException("provider-body-secret", "AbortError")) },
    })))
    const { client, sleep } = makeClient(fetchImpl)
    let error: unknown
    try { await client.getCardById("EN", "sv06-1") } catch (caught) { error = caught }
    expect(error).toMatchObject({ code: TCGDEX_ERROR_CODE.TIMEOUT, attemptCount: 4 })
    expect(error).not.toMatchObject({ message: expect.stringContaining("provider-body-secret") })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it("does not leak a reader cancellation failure or retry an invalid oversized response", async () => {
    const cancelError = new Error("cancel-provider-secret")
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(10_001)) },
      cancel() { return Promise.reject(cancelError) },
    })
    const fetchImpl = jest.fn(async () => responseWithBody(body))
    const { client, sleep } = makeClient(fetchImpl)
    let error: unknown
    try { await client.getCardById("EN", "sv06-1") } catch (caught) { error = caught }
    expect(error).toMatchObject({ code: TCGDEX_ERROR_CODE.INVALID_RESPONSE, attemptCount: 1 })
    expect(error).not.toMatchObject({ message: expect.stringContaining("cancel-provider-secret") })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("classifies rejected redirects safely", async () => {
    const fetchImpl = jest.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error")
      throw new TypeError("redirected-to-provider-secret")
    })
    const { client } = makeClient(fetchImpl)
    let error: unknown
    try { await client.getCardById("EN", "sv06-1") } catch (caught) { error = caught }
    expect(error).toMatchObject({ code: TCGDEX_ERROR_CODE.NETWORK_ERROR, attemptCount: 4 })
    expect(error).not.toMatchObject({ message: expect.stringContaining("redirected-to-provider-secret") })
  })

  it("rejects oversized responses without exposing the body", async () => {
    const fetchImpl = jest.fn(async () => response("x".repeat(10_001)))
    const { client } = makeClient(fetchImpl)
    await expect(client.getCardById("EN", "sv06-1")).rejects.toMatchObject({ code: TCGDEX_ERROR_CODE.INVALID_RESPONSE })
    await expect(client.getCardById("EN", "sv06-1")).rejects.not.toThrow("xxxxx")
  })

  it("clears the request timeout after a successful response", async () => {
    jest.useFakeTimers()
    try {
      const fetchImpl = jest.fn(async () => response(validCard()))
      const { client } = makeClient(fetchImpl)
      await expect(client.getCardById("EN", "sv06-1")).resolves.toMatchObject({ id: "sv06-1" })
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe("TCGdex configuration", () => {
  it("rejects invalid values and insecure non-local URLs", () => {
    expect(() => loadTcgDexConfig({ TCGDEX_API_BASE_URL: "http://example.com" })).toThrow(TcgDexError)
    expect(() => loadTcgDexConfig({ TCGDEX_REQUEST_TIMEOUT_MS: "0" })).toThrow(TcgDexError)
    expect(() => loadTcgDexConfig({ TCGDEX_RETRY_BASE_DELAY_MS: "10", TCGDEX_RETRY_MAX_DELAY_MS: "5" })).toThrow(TcgDexError)

    try { loadTcgDexConfig({ TCGDEX_API_BASE_URL: "http://example.com" }) } catch (error) {
      expect(error).toMatchObject({ code: TCGDEX_ERROR_CODE.CONFIGURATION_ERROR })
    }
  })

  it("allows HTTP localhost only in test mode", () => {
    expect(loadTcgDexConfig({ NODE_ENV: "test", TCGDEX_API_BASE_URL: "http://localhost:9001" }).apiBaseUrl).toBe("http://localhost:9001")
  })
})
