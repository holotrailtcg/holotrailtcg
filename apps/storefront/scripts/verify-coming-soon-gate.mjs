#!/usr/bin/env node
/**
 * Integration-level verification that the Stage 2D coming-soon gate behaves
 * correctly through the actual compiled `config.matcher` + real Next.js HTTP
 * routing, not just the middleware() function called directly.
 *
 * `src/middleware.test.ts` proves the middleware's redirect/pass-through
 * *decisions* in isolation. It cannot prove: (a) that `config.matcher` lets
 * requests reach `middleware()` in the first place, (b) that a real browser
 * gets a single-hop redirect with no forwarded query string, or (c) that
 * genuine static assets are actually served by Next's static file handler
 * rather than merely "not redirected" by the middleware unit under test.
 * This script fills that gap over real HTTP, following the same structure
 * and Windows-safe teardown as `scripts/verify-final-404.mjs`.
 *
 * It starts:
 *   1. A minimal local HTTP stub standing in for the Medusa `/store/regions`
 *      endpoint (no real backend dependency).
 *   2. Two real storefront (`next dev`) instances on dynamically chosen free
 *      ports, pointed at that stub — one with COMING_SOON_MODE=true, one
 *      with COMING_SOON_MODE=false — so both policies are verified in the
 *      same run without restarting a server mid-script.
 *
 * Then it asserts, over real HTTP, for the gated instance:
 *   - Allowlisted routes (/gb/coming-soon, /gb/privacy, a newsletter result
 *     page) return 200.
 *   - Commerce routes and the Codex-reported dotted/encoded application
 *     routes (/gb/products/card.v2, /gb/order/.../transfer/a.b.c, ...) all
 *     redirect (307) to exactly `/gb/coming-soon` with no forwarded query
 *     string, and that target itself resolves in one further hop (200, no
 *     second redirect).
 *   - Genuine static/framework assets (favicon, opengraph image, a real
 *     public/images file, a real Next static chunk) return 200, not a
 *     coming-soon redirect.
 * ...and for the disabled instance, that the same commerce/dotted routes are
 * NOT redirected to /gb/coming-soon (full page render success isn't
 * required, since the region stub has no product catalog data).
 *
 * Usage: `pnpm run verify:coming-soon` from `apps/storefront`.
 */

import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { createServer as createNetServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STOREFRONT_ROOT = path.resolve(__dirname, "..")
const IS_WINDOWS = process.platform === "win32"

const READY_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 500
const TERMINATE_TIMEOUT_MS = 10_000
const TERMINATE_GRACE_MS = 4_000

/** Find a currently-free TCP port without adding a "get-port"-style dependency. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.on("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address()
      probe.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

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

function startStorefront(port, backendUrl, comingSoonMode) {
  return spawn(
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
        NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_test_verify_coming_soon",
        NEXT_PUBLIC_DEFAULT_REGION: "gb",
        COMING_SOON_MODE: comingSoonMode,
      },
      stdio: ["ignore", "pipe", "pipe"],
      // See scripts/verify-final-404.mjs for why POSIX uses a detached
      // process group and Windows relies on `taskkill /T` instead.
      detached: !IS_WINDOWS,
    }
  )
}

/**
 * Resolves once the spawned Next process has both announced readiness on its
 * own stdout for our exact port and served a real 200 with Next's
 * `x-powered-by` header from `/gb/coming-soon` (a route that renders
 * directly regardless of COMING_SOON_MODE, so it is a valid readiness probe
 * for both instances). See scripts/verify-final-404.mjs for the rationale
 * behind gating on stdout rather than blind HTTP polling.
 */
function waitUntilReady(child, port, origin, getOutput) {
  return new Promise((resolve, reject) => {
    let settled = false
    let pollTimer

    const finishOk = () => {
      if (settled) return
      settled = true
      clearTimeout(pollTimer)
      child.off("error", onChildError)
      child.off("exit", onChildExit)
      resolve()
    }

    const finishFail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(pollTimer)
      child.off("error", onChildError)
      child.off("exit", onChildExit)
      reject(error)
    }

    function onChildError(err) {
      finishFail(new Error(`Next process failed to start: ${err.message}`))
    }

    function onChildExit(code, signal) {
      finishFail(
        new Error(
          `Next process exited before becoming ready (code=${code}, signal=${signal})`
        )
      )
    }

    child.once("error", onChildError)
    child.once("exit", onChildExit)

    const deadline = Date.now() + READY_TIMEOUT_MS

    async function poll() {
      if (settled) return
      if (Date.now() >= deadline) {
        finishFail(
          new Error(`Storefront did not become ready within ${READY_TIMEOUT_MS}ms`)
        )
        return
      }

      const output = getOutput()
      const childAnnouncedReady =
        output.includes(`:${port}`) && /Ready in/i.test(output)

      if (childAnnouncedReady) {
        try {
          const res = await fetch(`${origin}/gb/coming-soon`)
          const poweredBy = res.headers.get("x-powered-by") ?? ""
          if (res.status === 200 && /next\.js/i.test(poweredBy)) {
            finishOk()
            return
          }
        } catch {
          // Not accepting connections yet, or the port briefly serves
          // something else during startup; keep polling.
        }
      }

      pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    void poll()
  })
}

/** See scripts/verify-final-404.mjs for full rationale. */
function killProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || child.pid == null || child.exitCode !== null || child.signalCode !== null) {
      resolve(null)
      return
    }

    let settled = false
    let graceTimer
    let overallTimer

    const finish = (failure = null) => {
      if (settled) return
      settled = true
      clearTimeout(graceTimer)
      clearTimeout(overallTimer)
      resolve(failure)
    }

    child.once("close", () => finish(null))

    overallTimer = setTimeout(() => {
      finish(
        `Timed out after ${TERMINATE_TIMEOUT_MS}ms waiting for the Next process (pid=${child.pid}) to exit.`
      )
    }, TERMINATE_TIMEOUT_MS)

    if (IS_WINDOWS) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      })
      killer.once("error", (err) => {
        finish(`taskkill failed to run for pid ${child.pid}: ${err.message}`)
      })
      killer.once("close", (code) => {
        if (code !== 0 && child.exitCode === null && child.signalCode === null) {
          finish(`taskkill exited with code ${code} for pid ${child.pid}`)
        }
      })
      return
    }

    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      try {
        child.kill("SIGTERM")
      } catch {
        // Process may already have exited.
      }
    }

    graceTimer = setTimeout(() => {
      if (settled) return
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        try {
          child.kill("SIGKILL")
        } catch {
          // Process may already have exited.
        }
      }
    }, TERMINATE_GRACE_MS)
  })
}

/** See scripts/verify-final-404.mjs for full rationale. */
function closeServer(server, timeoutMs = TERMINATE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve(null)
      return
    }

    let settled = false
    const finish = (failure = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(failure)
    }

    const timer = setTimeout(() => {
      finish(`Timed out after ${timeoutMs}ms closing the region stub.`)
    }, timeoutMs)

    server.close((err) => {
      finish(err ? `Error closing region stub: ${err.message}` : null)
    })
    server.closeAllConnections?.()
  })
}

const DOTTED_APPLICATION_ROUTES = [
  "/gb/products/card.v2",
  "/gb/collections/set.v2",
  "/gb/categories/cards.v2",
  "/gb/order/order_123/transfer/a.b.c",
  "/gb/order/order_123/transfer/a.b.c/accept",
  "/gb/order/order_123/transfer/a.b.c/decline",
  "/gb/products/card%2Ev2",
]

const COMMERCE_ROUTES = ["/gb/store", "/gb/cart", "/gb/checkout", "/gb/account"]

const STATIC_ASSET_ROUTES = [
  "/favicon.ico",
  "/opengraph-image.jpg",
  "/images/akin-cakiner-9cIkK-hLD9k-unsplash.jpg",
]

async function verifyGatedInstance(origin, failures) {
  const label = (msg) => `[gated] ${msg}`

  for (const path of ["/gb/coming-soon", "/gb/privacy"]) {
    const res = await fetch(`${origin}${path}`)
    if (res.status !== 200) {
      failures.push(label(`GET ${path} expected 200, got ${res.status}`))
    }
  }

  const newsletterRes = await fetch(
    `${origin}/gb/newsletter/confirm?result=confirmed`
  )
  if (newsletterRes.status !== 200) {
    failures.push(
      label(
        `GET /gb/newsletter/confirm?result=confirmed expected 200, got ${newsletterRes.status}`
      )
    )
  }

  for (const path of [...COMMERCE_ROUTES, ...DOTTED_APPLICATION_ROUTES]) {
    const res = await fetch(`${origin}${path}`, { redirect: "manual" })
    if (res.status !== 307) {
      failures.push(label(`GET ${path} expected 307, got ${res.status}`))
      continue
    }
    const rawLocation = res.headers.get("location") ?? ""
    const location = rawLocation ? new URL(rawLocation, origin).href : ""
    if (location !== `${origin}/gb/coming-soon`) {
      failures.push(
        label(
          `GET ${path} expected Location "${origin}/gb/coming-soon" (no forwarded query string), got "${rawLocation}"`
        )
      )
      continue
    }
    // Verify the redirect resolves in exactly one further hop.
    const followUp = await fetch(location, { redirect: "manual" })
    if (followUp.status !== 200) {
      failures.push(
        label(
          `GET ${path} -> ${location} expected a single-hop 200, got ${followUp.status}`
        )
      )
    }
  }

  // A query string on the gated request must not be carried to the
  // coming-soon redirect target.
  const withQuery = await fetch(`${origin}/gb/store?foo=bar&baz=qux`, {
    redirect: "manual",
  })
  const withQueryLocation = withQuery.headers.get("location") ?? ""
  if (withQueryLocation.includes("?")) {
    failures.push(
      label(
        `GET /gb/store?foo=bar&baz=qux expected a query-string-free redirect, got Location "${withQueryLocation}"`
      )
    )
  }

  for (const path of STATIC_ASSET_ROUTES) {
    const res = await fetch(`${origin}${path}`, { redirect: "manual" })
    if (res.status === 307 && res.headers.get("location")?.includes("coming-soon")) {
      failures.push(
        label(`GET ${path} was redirected to coming-soon; expected a real asset response`)
      )
    } else if (res.status >= 400) {
      failures.push(label(`GET ${path} expected a real asset response, got ${res.status}`))
    }
  }

  // A real Next.js static chunk path, discovered from the dev server's own
  // asset manifest rather than guessed, to avoid a brittle hard-coded chunk
  // name.
  const buildManifest = await fetch(`${origin}/_next/static/development/_buildManifest.js`)
  if (buildManifest.status !== 200) {
    failures.push(
      label(
        `GET /_next/static/development/_buildManifest.js expected 200, got ${buildManifest.status}`
      )
    )
  }
}

async function verifyDisabledInstance(origin, failures) {
  const label = (msg) => `[disabled] ${msg}`

  for (const path of [...COMMERCE_ROUTES, ...DOTTED_APPLICATION_ROUTES]) {
    const res = await fetch(`${origin}${path}`, { redirect: "manual" })
    const location = res.headers.get("location") ?? ""
    if (res.status === 307 && location.includes("coming-soon")) {
      failures.push(
        label(`GET ${path} was redirected to coming-soon while COMING_SOON_MODE=false`)
      )
    }
  }
}

async function main() {
  const stub = await startRegionStub()
  const stubPort = stub.address().port
  const backendUrl = `http://127.0.0.1:${stubPort}`

  const gatedPort = await getFreePort()
  const disabledPort = await getFreePort()
  const gatedOrigin = `http://127.0.0.1:${gatedPort}`
  const disabledOrigin = `http://127.0.0.1:${disabledPort}`

  const gatedChild = startStorefront(gatedPort, backendUrl, "true")
  const disabledChild = startStorefront(disabledPort, backendUrl, "false")

  let gatedOutput = ""
  gatedChild.stdout?.on("data", (chunk) => (gatedOutput += chunk.toString()))
  gatedChild.stderr?.on("data", (chunk) => (gatedOutput += chunk.toString()))

  let disabledOutput = ""
  disabledChild.stdout?.on("data", (chunk) => (disabledOutput += chunk.toString()))
  disabledChild.stderr?.on("data", (chunk) => (disabledOutput += chunk.toString()))

  const failures = []

  try {
    await Promise.all([
      waitUntilReady(gatedChild, gatedPort, gatedOrigin, () => gatedOutput),
      waitUntilReady(disabledChild, disabledPort, disabledOrigin, () => disabledOutput),
    ])

    await verifyGatedInstance(gatedOrigin, failures)
    await verifyDisabledInstance(disabledOrigin, failures)
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  } finally {
    const [gatedKillFailure, disabledKillFailure, closeFailure] = await Promise.all([
      killProcessTree(gatedChild),
      killProcessTree(disabledChild),
      closeServer(stub),
    ])
    if (gatedKillFailure) failures.push(gatedKillFailure)
    if (disabledKillFailure) failures.push(disabledKillFailure)
    if (closeFailure) failures.push(closeFailure)
  }

  if (failures.length > 0) {
    console.error("verify-coming-soon-gate FAILED:")
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error("\n--- gated storefront output (tail) ---")
    console.error(gatedOutput.split("\n").slice(-40).join("\n"))
    console.error("\n--- disabled storefront output (tail) ---")
    console.error(disabledOutput.split("\n").slice(-40).join("\n"))
    process.exit(1)
  }

  console.log(
    "verify-coming-soon-gate PASSED: dotted/encoded application routes, commerce routes and static assets are all gated correctly over real HTTP."
  )
}

main()
