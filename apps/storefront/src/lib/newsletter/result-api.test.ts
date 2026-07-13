import { afterEach, describe, expect, it, vi } from "vitest"

import { getConfirmationResult, getUnsubscribeResult } from "./result-api"

afterEach(() => {
  vi.unstubAllEnvs()
})

function configureBackend() {
  vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "https://backend.example")
  vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "pk_test")
}

describe("newsletter token result API", () => {
  it.each([
    ["confirmed"],
    ["already_confirmed"],
    ["invalid_or_expired"],
  ] as const)("maps confirmation result %s", async (result) => {
    configureBackend()
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result }, { status: 200 }),
    )
    await expect(
      getConfirmationResult("opaque-token", fetchMock as typeof fetch),
    ).resolves.toBe(result)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://backend.example/store/newsletter/confirm?token=opaque-token",
    )
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" })
  })

  it.each([["unsubscribed"], ["already_unsubscribed"], ["invalid"]] as const)(
    "maps unsubscribe result %s",
    async (result) => {
      configureBackend()
      await expect(
        getUnsubscribeResult(
          "opaque-token",
          vi.fn(async () => Response.json({ result }, { status: 200 })),
        ),
      ).resolves.toBe(result)
    },
  )

  it("maps provider, malformed JSON, and network failures to temporary error", async () => {
    configureBackend()
    await expect(
      getConfirmationResult(
        "token",
        vi.fn(async () => new Response(null, { status: 503 })),
      ),
    ).resolves.toBe("temporary_error")
    await expect(
      getConfirmationResult(
        "token",
        vi.fn(async () => Response.json({ detail: "raw" })),
      ),
    ).resolves.toBe("temporary_error")
    await expect(
      getUnsubscribeResult(
        "token",
        vi.fn(async () => {
          throw new Error("provider details")
        }),
      ),
    ).resolves.toBe("temporary_error")
  })

  it("does not call the backend when a token is absent", async () => {
    configureBackend()
    const fetchImpl = vi.fn()
    await expect(getConfirmationResult(undefined, fetchImpl)).resolves.toBe(
      "invalid_or_expired",
    )
    await expect(getUnsubscribeResult(undefined, fetchImpl)).resolves.toBe(
      "invalid",
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("fails safely as temporary when backend configuration is absent", async () => {
    const fetchImpl = vi.fn()
    await expect(getConfirmationResult("token", fetchImpl)).resolves.toBe(
      "temporary_error",
    )
    await expect(getUnsubscribeResult("token", fetchImpl)).resolves.toBe(
      "temporary_error",
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
