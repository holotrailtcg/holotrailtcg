/**
 * Unit tests for `ResendConfirmationEmailSender`. The official `resend`
 * SDK is mocked at the module boundary so no network call is ever made and
 * no real API key is required — `jest.mock("resend", ...)` replaces the
 * `Resend` class with a stub whose `emails.send` is a `jest.fn()` the test
 * controls directly.
 */
const sendMock = jest.fn()

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}))

import { ResendConfirmationEmailSender } from "../sender"
import type { RenderedConfirmationEmail } from "../render"

const rendered: RenderedConfirmationEmail = {
  subject: "Confirm your Holo Trail TCG updates",
  html: "<p>hi</p>",
  text: "hi",
}

const baseInput = {
  toEmail: "person@example.com",
  rendered,
  idempotencyKey: "idem-key-123",
}

const buildSender = () =>
  new ResendConfirmationEmailSender({
    apiKey: "re_test_key",
    fromEmail: "Holo Trail TCG <hello@holotrailtcg.example>",
    replyToEmail: "support@holotrailtcg.example",
  })

describe("ResendConfirmationEmailSender", () => {
  const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined)
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)

  beforeEach(() => {
    sendMock.mockReset()
    logSpy.mockClear()
    errorSpy.mockClear()
  })

  afterAll(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("returns SENT with the provider message id on success", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null })
    const sender = buildSender()
    const result = await sender.send(baseInput)
    expect(result).toEqual({ status: "SENT", providerMessageId: "msg_123" })
  })

  it("passes idempotencyKey as a request option, not a payload field", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null })
    const sender = buildSender()
    await sender.send(baseInput)

    const [payload, options] = sendMock.mock.calls[0]
    expect(payload.idempotencyKey).toBeUndefined()
    expect(options).toEqual({ idempotencyKey: "idem-key-123" })
  })

  it("sends from/replyTo/subject/html/text from configuration and rendered content", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null })
    const sender = buildSender()
    await sender.send(baseInput)

    const [payload] = sendMock.mock.calls[0]
    expect(payload.from).toBe("Holo Trail TCG <hello@holotrailtcg.example>")
    expect(payload.replyTo).toBe("support@holotrailtcg.example")
    expect(payload.to).toEqual(["person@example.com"])
    expect(payload.subject).toBe(rendered.subject)
    expect(payload.html).toBe(rendered.html)
    expect(payload.text).toBe(rendered.text)
  })

  it("classifies a definitive rejection (invalid_from_address) as FAILED", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "invalid_from_address", message: "bad from" },
    })
    const sender = buildSender()
    const result = await sender.send(baseInput)
    expect(result).toEqual({ status: "FAILED" })
  })

  it("classifies rate_limit_exceeded as FAILED (definitively not sent, safe to retry later)", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "too many requests" },
    })
    const sender = buildSender()
    const result = await sender.send(baseInput)
    expect(result).toEqual({ status: "FAILED" })
  })

  it("classifies an unrecognised error name (e.g. a 5xx) as AMBIGUOUS", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "internal_server_error", message: "oops" },
    })
    const sender = buildSender()
    const result = await sender.send(baseInput)
    expect(result).toEqual({ status: "AMBIGUOUS" })
  })

  it("classifies a thrown network error as AMBIGUOUS", async () => {
    sendMock.mockRejectedValue(new Error("ECONNRESET"))
    const sender = buildSender()
    const result = await sender.send(baseInput)
    expect(result).toEqual({ status: "AMBIGUOUS" })
  })

  it("classifies a malformed success response (no id) as AMBIGUOUS", async () => {
    sendMock.mockResolvedValue({ data: {}, error: null })
    const sender = buildSender()
    const result = await sender.send(baseInput)
    expect(result).toEqual({ status: "AMBIGUOUS" })
  })

  it("classifies a timeout as AMBIGUOUS without waiting indefinitely", async () => {
    jest.useFakeTimers()
    sendMock.mockImplementation(() => new Promise(() => {})) // never resolves
    const sender = buildSender()

    const resultPromise = sender.send(baseInput)
    jest.advanceTimersByTime(10_000)
    const result = await resultPromise

    expect(result).toEqual({ status: "AMBIGUOUS" })
    jest.useRealTimers()
  })

  it("never logs the API key, recipient email, token, or raw provider response", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null })
    const sender = buildSender()
    await sender.send(baseInput)

    const loggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ")
    expect(loggedText).not.toContain("re_test_key")
    expect(loggedText).not.toContain("person@example.com")
    expect(loggedText).not.toContain("idem-key-123")
    expect(loggedText).not.toContain("msg_123")
  })

  it("does not automatically retry a failed send", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "invalid_from_address", message: "bad from" },
    })
    const sender = buildSender()
    await sender.send(baseInput)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})
