/**
 * `medusa-config.ts` gained `admin: { disable: process.env.MEDUSA_ADMIN_DISABLE === "true" }`
 * (Stage 2C.6) so the newsletter HTTP integration test harness
 * (`integration-tests/http/support/bootstrap.ts`) can boot the real Medusa
 * app without a built Admin UI. `MEDUSA_ADMIN_DISABLE` is set only by that
 * test harness — it is not a normal, documented project environment
 * variable (it is absent from `.env.template`/`docs/operations/environment-variables.md`)
 * and must never disable Admin for ordinary local development or
 * production. This test proves the condition is exactly scoped to the
 * literal string `"true"` and that Admin stays enabled whenever the
 * variable is unset or holds anything else.
 */

function loadConfig(): { admin?: { disable?: boolean } } {
  let config: { admin?: { disable?: boolean } } | undefined
  jest.isolateModules(() => {
    config = require("../../medusa-config")
  })
  if (!config) {
    throw new Error("medusa-config.ts did not export a config object")
  }
  return config
}

describe("medusa-config.ts admin.disable scoping", () => {
  const originalValue = process.env.MEDUSA_ADMIN_DISABLE

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.MEDUSA_ADMIN_DISABLE
    } else {
      process.env.MEDUSA_ADMIN_DISABLE = originalValue
    }
  })

  it("keeps Admin enabled when MEDUSA_ADMIN_DISABLE is unset", () => {
    delete process.env.MEDUSA_ADMIN_DISABLE
    expect(loadConfig().admin?.disable).toBe(false)
  })

  it("disables Admin only for the exact literal string \"true\"", () => {
    process.env.MEDUSA_ADMIN_DISABLE = "true"
    expect(loadConfig().admin?.disable).toBe(true)
  })

  it.each(["1", "TRUE", "True", "yes", "on", ""])(
    "keeps Admin enabled for %j (not the exact literal \"true\")",
    (value) => {
      process.env.MEDUSA_ADMIN_DISABLE = value
      expect(loadConfig().admin?.disable).toBe(false)
    }
  )
})
