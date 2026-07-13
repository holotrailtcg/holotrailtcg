#!/usr/bin/env node
/**
 * Integration-level verification that a genuinely missing route finishes with
 * a real HTTP 404 through the actual middleware + app-router pipeline.
 *
 * This is intentionally NOT part of `pnpm test` (Vitest). Vitest's
 * `src/middleware.test.ts` proves the middleware's redirect/pass-through
 * *decisions* by calling the real `middleware()` export directly, but it
 * cannot prove the final response status a browser receives, because that
 * depends on Next's app router resolving no matching route and rendering
 * `not-found.tsx` — behaviour that only exists once a real Next server is
 * running. Embedding a full server boot inside the Vitest run would risk
 * flaky/slow unit tests, so this is a separate, explicit script instead.
 *
 * It starts:
 *   1. A minimal local HTTP stub standing in for the Medusa `/store/regions`
 *      endpoint (so the middleware's region lookup succeeds without needing a
 *      real backend — this script does not start or depend on any Stage 2C+
 *      backend infrastructure).
 *   2. The real storefront (`next dev`) on an ephemeral port, pointed at that
 *      stub.
 *
 * Then it asserts, over real HTTP:
 *   - GET /gb/does-not-exist  -> 404 (valid country prefix, unknown route)
 *   - GET /definitely-missing -> 404 after the middleware's own redirect to
 *     /gb/definitely-missing (no country prefix, still unknown route)
 *
 * Usage: `pnpm run verify:404` from `apps/storefront`.
 */

import { createServer } from "node:http"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STOREFRONT_ROOT = path.resolve(__dirname, "..")
const READY_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 500

function startRegionStub() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url?.startsWith("/store/regions")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            regions: [{ id: "reg_gb", countries: [{ iso_2: "gb" }] }],
          })
        )
        return
      }
      res.writeHead(404)
      res.end()
    })
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

function startStorefront(port, backendUrl) {
  const child = spawn(
    "node",
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--turbopack",
      "-p",
      String(port),
    ],
    {
      cwd: STOREFRONT_ROOT,
      env: {
        ...process.env,
        NEXT_PUBLIC_MEDUSA_BACKEND_URL: backendUrl,
        NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_test_verify_final_404",
        NEXT_PUBLIC_DEFAULT_REGION: "gb",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  return child
}

async function waitUntilReady(origin, deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/gb/coming-soon`)
      if (res.status === 200) return
    } catch {
      // Server not accepting connections yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Storefront did not become ready within ${READY_TIMEOUT_MS}ms`)
}

async function main() {
  const stub = await startRegionStub()
  const stubPort = stub.address().port
  const backendUrl = `http://127.0.0.1:${stubPort}`

  const appPort = 8731 // fixed, unlikely-to-collide dev-only verification port
  const origin = `http://127.0.0.1:${appPort}`
  const child = startStorefront(appPort, backendUrl)

  let childOutput = ""
  child.stdout?.on("data", (chunk) => {
    childOutput += chunk.toString()
  })
  child.stderr?.on("data", (chunk) => {
    childOutput += chunk.toString()
  })

  const failures = []

  try {
    await waitUntilReady(origin, Date.now() + READY_TIMEOUT_MS)

    const knownCountryMissingRoute = await fetch(`${origin}/gb/does-not-exist`)
    if (knownCountryMissingRoute.status !== 404) {
      failures.push(
        `GET /gb/does-not-exist expected 404, got ${knownCountryMissingRoute.status}`
      )
    }

    const unprefixedMissingRoute = await fetch(`${origin}/definitely-missing`)
    if (unprefixedMissingRoute.status !== 404) {
      failures.push(
        `GET /definitely-missing expected a final 404 (after middleware localisation), got ${unprefixedMissingRoute.status}`
      )
    }
    if (!unprefixedMissingRoute.url.endsWith("/gb/definitely-missing")) {
      failures.push(
        `GET /definitely-missing expected to be localised to /gb/definitely-missing, ` +
          `landed on ${unprefixedMissingRoute.url}`
      )
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  } finally {
    child.kill()
    stub.close()
  }

  if (failures.length > 0) {
    console.error("verify-final-404 FAILED:")
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error("\n--- storefront dev server output (tail) ---")
    console.error(childOutput.split("\n").slice(-40).join("\n"))
    process.exit(1)
  }

  console.log(
    "verify-final-404 PASSED: /gb/does-not-exist and /definitely-missing both finish with a real 404."
  )
}

main()
