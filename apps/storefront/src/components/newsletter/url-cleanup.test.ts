import { describe, expect, it, vi } from "vitest"

import { replaceSensitiveUrl } from "./url-cleanup"

describe("newsletter token URL cleanup", () => {
  it("replaces the current entry with the clean country-aware path", () => {
    const replaceState = vi.fn()
    const history = { state: { existing: true }, replaceState }
    replaceSensitiveUrl(history, "/gb/newsletter/confirm")
    expect(replaceState).toHaveBeenCalledOnce()
    expect(replaceState).toHaveBeenCalledWith(
      history.state,
      "",
      "/gb/newsletter/confirm",
    )
  })

  it("does not create an additional history entry", () => {
    const history = { state: null, replaceState: vi.fn(), pushState: vi.fn() }
    replaceSensitiveUrl(history, "/gb/newsletter/unsubscribe")
    expect(history.replaceState).toHaveBeenCalledOnce()
    expect(history.pushState).not.toHaveBeenCalled()
  })
})
