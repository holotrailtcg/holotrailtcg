import { resolveCardImageCleanupDryRun } from "../cleanup-config"

describe("resolveCardImageCleanupDryRun", () => {
  it("defaults to dry-run when the variable is unset", () => {
    expect(resolveCardImageCleanupDryRun({})).toBe(true)
  })

  it("defaults to dry-run when the variable is empty", () => {
    expect(resolveCardImageCleanupDryRun({ CARD_IMAGE_CLEANUP_DRY_RUN: "" })).toBe(true)
  })

  it("enables real deletion only for the exact lowercase string \"false\"", () => {
    expect(resolveCardImageCleanupDryRun({ CARD_IMAGE_CLEANUP_DRY_RUN: "false" })).toBe(false)
  })

  it.each([
    "FALSE", "False", " false", "false ", "0", "no", "off", "null", "undefined",
  ])("treats malformed value %j as dry-run", (value) => {
    expect(resolveCardImageCleanupDryRun({ CARD_IMAGE_CLEANUP_DRY_RUN: value })).toBe(true)
  })

  it("treats \"true\" as dry-run (it is the safe default, not a special opt-out)", () => {
    expect(resolveCardImageCleanupDryRun({ CARD_IMAGE_CLEANUP_DRY_RUN: "true" })).toBe(true)
  })
})
