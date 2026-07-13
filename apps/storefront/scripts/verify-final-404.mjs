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
 *   2. The real storefront (`next dev`) on a dynamically chosen free port,
 *      pointed at that stub.
 *
 * Then it asserts, over real HTTP:
 *   - GET /gb/does-not-exist  -> 404 (valid country prefix, unknown route)
 *   - GET /definitely-missing -> 404 after the middleware's own redirect to
 *     /gb/definitely-missing (no country prefix, still unknown route)
 *
 * Both the spawned Next process (and any workers it forks) and the region
 * stub are torn down with a bounded timeout on every exit path, including
 * Windows, where a plain `child.kill()` only signals the immediate `node`
 * process and leaves Next's own child processes running.
 *
 * Usage: `pnpm run verify:404` from `apps/storefront`.
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

function startStorefront(port, backendUrl) {
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
        NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_test_verify_final_404",
        NEXT_PUBLIC_DEFAULT_REGION: "gb",
      },
      stdio: ["ignore", "pipe", "pipe"],
      // POSIX: makes `child` the leader of its own process group, so we can
      // terminate the whole tree (Next forks additional workers) by signalling
      // the negative pid. Windows has no equivalent process-group signalling,
      // so termination there goes through `taskkill /T` instead (see
      // `killProcessTree`) and `detached` is left off to avoid spawning a
      // detached console.
      detached: !IS_WINDOWS,
    }
  )
}

/**
 * Resolves once the spawned Next process has both (a) announced readiness on
 * its own stdout for our exact port, and (b) served a 200 with Next's
 * `x-powered-by` header from that same origin. Gating on the child's own
 * stdout output — rather than blind HTTP polling — ensures a stray,
 * unrelated process that happens to already be listening on the chosen port
 * cannot be mistaken for the instance this script started; the header check
 * is a second, independent confirmation that the response actually came from
 * a Next.js server.
 *
 * Rejects immediately (without waiting out the poll timeout) if the child
 * process errors or exits before readiness is reached.
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

/**
 * Terminates the whole process tree Next started, awaiting real teardown (or
 * a bounded timeout) so callers never hang indefinitely and never leave
 * orphaned processes behind. Resolves `null` on successful cleanup (including
 * when the process had already exited before this ran), or a failure message
 * describing what did not complete — the caller is responsible for treating
 * that as a genuine failure rather than a silent best-effort.
 *
 * Windows has no process-group signalling, so it shells out to
 * `taskkill /PID <pid> /T /F` and awaits that child's own `close` event,
 * checking both its exit code and whether it failed to spawn at all. POSIX
 * signals the negative pid (the process group created via `detached: true`
 * in `startStorefront`) and escalates from SIGTERM to SIGKILL if the tree
 * hasn't exited after a grace period; no further process enumeration is
 * needed there.
 *
 * Completion is tracked via the Next child's `close` event (all stdio
 * streams have ended), not `exit` alone, since `exit` can fire slightly
 * before teardown is actually finished.
 */
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
        // taskkill exits non-zero if it could not find or terminate the
        // process. If the Next process has already exited by the time this
        // fires (its own "close" already resolved us via `finish(null)`
        // above, or is about to), that is successful cleanup, not a failure.
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

/**
 * Closes the region stub, resolving `null` on success or a failure message
 * describing what did not complete. Per Node's guidance, `close()` — which
 * stops accepting new connections and fires once all existing ones end — is
 * called first; `closeAllConnections()` follows immediately after to force
 * any idle/keep-alive sockets shut so that `close()`'s callback cannot hang
 * waiting on a connection that would otherwise never end on its own.
 */
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

async function main() {
  const stub = await startRegionStub()
  const stubPort = stub.address().port
  const backendUrl = `http://127.0.0.1:${stubPort}`

  const appPort = await getFreePort()
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
    await waitUntilReady(child, appPort, origin, () => childOutput)

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
    // Cleanup failures/timeouts are genuine failures, not best-effort noise:
    // `PASSED` must never print over incomplete teardown of the Next process
    // tree or the region stub.
    const [killFailure, closeFailure] = await Promise.all([
      killProcessTree(child),
      closeServer(stub),
    ])
    if (killFailure) failures.push(killFailure)
    if (closeFailure) failures.push(closeFailure)
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
