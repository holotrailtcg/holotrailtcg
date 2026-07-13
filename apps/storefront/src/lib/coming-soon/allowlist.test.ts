import { describe, expect, it } from "vitest"

import { isAllowlistedDuringComingSoon } from "./allowlist"

describe("isAllowlistedDuringComingSoon", () => {
  it.each(["/coming-soon", "/privacy", "/newsletter/confirm", "/newsletter/unsubscribe"])(
    "allows %s",
    (path) => {
      expect(isAllowlistedDuringComingSoon(path)).toBe(true)
    },
  )

  it.each(["/coming-soon/", "/privacy/"])("allows a trailing slash on %s", (path) => {
    expect(isAllowlistedDuringComingSoon(path)).toBe(true)
  })

  it.each([
    "/",
    "/store",
    "/collections/some-set",
    "/categories/pokemon",
    "/products/some-card",
    "/cart",
    "/checkout",
    "/account",
    "/account/orders",
    "/order/order_123/confirmed",
    "/verify-account",
    "/coming-soon-extra",
    "/newsletter",
    "/newsletter/confirm/extra",
    "/does-not-exist",
  ])("gates %s", (path) => {
    expect(isAllowlistedDuringComingSoon(path)).toBe(false)
  })
})
