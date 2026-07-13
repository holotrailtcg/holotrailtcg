import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

function runConfigCheck({
  nodeEnv,
  siteKey,
}: {
  nodeEnv: "development" | "production"
  siteKey?: string
}) {
  const env = {
    ...process.env,
    NODE_ENV: nodeEnv,
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "test-publishable-key",
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: siteKey ?? "",
  }

  return spawnSync(
    process.execPath,
    ["-e", 'require("./check-env-variables")()'],
    { cwd: process.cwd(), env, encoding: "utf8" },
  )
}

describe("storefront newsletter configuration loading", () => {
  it("allows unrelated development rendering without a reCAPTCHA site key", () => {
    expect(runConfigCheck({ nodeEnv: "development" }).status).toBe(0)
  })

  it("requires the public reCAPTCHA site key for production builds", () => {
    expect(runConfigCheck({ nodeEnv: "production" }).status).toBe(1)
    expect(
      runConfigCheck({ nodeEnv: "production", siteKey: "test-site-key" })
        .status,
    ).toBe(0)
  })

  it("suppresses only token-bearing newsletter request logs", () => {
    const script = `
      const config = require("./next.config")
      const patterns = config.logging.incomingRequests.ignore
      const result = {
        confirm: patterns.some((pattern) => pattern.test("/gb/newsletter/confirm?token=sensitive")),
        unsubscribe: patterns.some((pattern) => pattern.test("/newsletter/unsubscribe?token=sensitive")),
        comingSoon: patterns.some((pattern) => pattern.test("/gb/coming-soon")),
      }
      process.stdout.write(JSON.stringify(result))
    `
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "test-publishable-key",
        NEXT_PUBLIC_RECAPTCHA_SITE_KEY: "",
      },
      encoding: "utf8",
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      confirm: true,
      unsubscribe: true,
      comingSoon: false,
    })
  })
})
