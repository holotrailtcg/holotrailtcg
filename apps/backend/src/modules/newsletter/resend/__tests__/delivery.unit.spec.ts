import { sendConfirmationEmailWithProtections } from "../delivery"
import { hashToken } from "../../lifecycle/token"
import type { ConfirmationEmailReservationOutcome } from "../../lifecycle/types"
import type { ConfirmationEmailDeliveryStore } from "../delivery"
import type { ConfirmationEmailSender, ConfirmationEmailSendOutcome } from "../sender"

const CONFIG = {
  storefrontBaseUrl: "https://holotrailtcg.example",
  confirmationEmailCooldownSeconds: 300,
  confirmationEmailStaleReservationSeconds: 120,
}

class FakeStore implements ConfirmationEmailDeliveryStore {
  reservationResult: ConfirmationEmailReservationOutcome = { reserved: true }
  reserveCalls: Array<{ subscriberId: string; confirmationTokenHash: string }> = []
  sentCalls: Array<{ subscriberId: string; confirmationTokenHash: string; sentAt: Date }> = []
  failedCalls: Array<{ subscriberId: string; confirmationTokenHash: string }> = []
  ambiguousCalls: Array<{ subscriberId: string; confirmationTokenHash: string }> = []

  async reserveConfirmationEmailSend(input: {
    subscriberId: string
    confirmationTokenHash: string
  }): Promise<ConfirmationEmailReservationOutcome> {
    this.reserveCalls.push(input)
    return this.reservationResult
  }

  async markConfirmationEmailSent(subscriberId: string, confirmationTokenHash: string, sentAt: Date) {
    this.sentCalls.push({ subscriberId, confirmationTokenHash, sentAt })
  }

  async markConfirmationEmailFailed(subscriberId: string, confirmationTokenHash: string) {
    this.failedCalls.push({ subscriberId, confirmationTokenHash })
  }

  async markConfirmationEmailAmbiguous(subscriberId: string, confirmationTokenHash: string) {
    this.ambiguousCalls.push({ subscriberId, confirmationTokenHash })
  }
}

class FakeSender implements ConfirmationEmailSender {
  outcome: ConfirmationEmailSendOutcome = { status: "SENT", providerMessageId: "msg_1" }
  calls: Array<{ toEmail: string; idempotencyKey: string }> = []

  async send(input: { toEmail: string; idempotencyKey: string }) {
    this.calls.push(input)
    return this.outcome
  }
}

const baseInput = (overrides: Partial<Parameters<typeof sendConfirmationEmailWithProtections>[0]> = {}) => ({
  store: new FakeStore(),
  sender: new FakeSender(),
  config: CONFIG,
  subscriberId: "nlsub_1",
  firstName: "Ash",
  email: "ash@example.com",
  countryCode: "gb",
  confirmationToken: "plaintext-token-abc",
  ...overrides,
})

describe("sendConfirmationEmailWithProtections", () => {
  it("sends and finalises as SENT when reservation succeeds and the provider accepts", async () => {
    const store = new FakeStore()
    const sender = new FakeSender()
    sender.outcome = { status: "SENT", providerMessageId: "msg_1" }

    const result = await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(result).toEqual({ status: "SENT" })
    expect(sender.calls).toHaveLength(1)
    expect(sender.calls[0].toEmail).toBe("ash@example.com")
    expect(store.sentCalls).toHaveLength(1)
    expect(store.failedCalls).toHaveLength(0)
    expect(store.ambiguousCalls).toHaveLength(0)
  })

  it("finalises as FAILED on a definitive provider rejection", async () => {
    const store = new FakeStore()
    const sender = new FakeSender()
    sender.outcome = { status: "FAILED" }

    const result = await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(result).toEqual({ status: "FAILED" })
    expect(store.failedCalls).toHaveLength(1)
    expect(store.sentCalls).toHaveLength(0)
  })

  it("finalises as AMBIGUOUS on an ambiguous provider outcome, without marking sent", async () => {
    const store = new FakeStore()
    const sender = new FakeSender()
    sender.outcome = { status: "AMBIGUOUS" }

    const result = await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(result).toEqual({ status: "AMBIGUOUS" })
    expect(store.ambiguousCalls).toHaveLength(1)
    expect(store.sentCalls).toHaveLength(0)
  })

  it("does not call the sender when the reservation is suppressed by cooldown", async () => {
    const store = new FakeStore()
    store.reservationResult = { reserved: false, reason: "SUPPRESSED_COOLDOWN" }
    const sender = new FakeSender()

    const result = await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(result).toEqual({ status: "SUPPRESSED_COOLDOWN" })
    expect(sender.calls).toHaveLength(0)
  })

  it("does not call the sender when another attempt is already in flight", async () => {
    const store = new FakeStore()
    store.reservationResult = { reserved: false, reason: "ALREADY_IN_FLIGHT" }
    const sender = new FakeSender()

    const result = await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(result).toEqual({ status: "ALREADY_IN_FLIGHT" })
    expect(sender.calls).toHaveLength(0)
  })

  it("does not call the sender for a stale (superseded) token", async () => {
    const store = new FakeStore()
    store.reservationResult = { reserved: false, reason: "STALE_TOKEN" }
    const sender = new FakeSender()

    const result = await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(result).toEqual({ status: "STALE_TOKEN" })
    expect(sender.calls).toHaveLength(0)
  })

  it("does not call the sender when the subscriber is no longer pending", async () => {
    const store = new FakeStore()
    store.reservationResult = { reserved: false, reason: "NOT_PENDING" }
    const sender = new FakeSender()

    const result = await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(result).toEqual({ status: "NOT_PENDING" })
    expect(sender.calls).toHaveLength(0)
  })

  it("reserves using the hash of the plaintext token, never the token itself", async () => {
    const store = new FakeStore()
    const sender = new FakeSender()

    await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(store.reserveCalls).toHaveLength(1)
    expect(store.reserveCalls[0].confirmationTokenHash).toBe(hashToken("plaintext-token-abc"))
    expect(store.reserveCalls[0].confirmationTokenHash).not.toBe("plaintext-token-abc")
  })

  it("derives a stable idempotency key for the same subscriber/token across repeated calls", async () => {
    const store = new FakeStore()
    const sender = new FakeSender()

    await sendConfirmationEmailWithProtections(baseInput({ store, sender }))
    await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(sender.calls).toHaveLength(2)
    expect(sender.calls[0].idempotencyKey).toBe(sender.calls[1].idempotencyKey)
  })

  it("derives a different idempotency key after a token rotation", async () => {
    const store = new FakeStore()
    const sender = new FakeSender()

    await sendConfirmationEmailWithProtections(baseInput({ store, sender, confirmationToken: "token-a" }))
    await sendConfirmationEmailWithProtections(baseInput({ store, sender, confirmationToken: "token-b" }))

    expect(sender.calls[0].idempotencyKey).not.toBe(sender.calls[1].idempotencyKey)
  })

  it("never leaks the confirmation token to the sender's recipient field", async () => {
    const store = new FakeStore()
    const sender = new FakeSender()

    await sendConfirmationEmailWithProtections(baseInput({ store, sender }))

    expect(sender.calls[0].toEmail).not.toContain("plaintext-token-abc")
  })
})
