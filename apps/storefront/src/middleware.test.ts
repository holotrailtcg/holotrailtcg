import { beforeAll, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

/**
 * Route-aware tests for the real country-code middleware. These import the
 * actual `middleware` export (no re-implementation) and assert that the
 * coming-soon, privacy and 404 return links resolve through it correctly.
 *
 * The middleware reads its configuration and fetches the region map at module
 * load, so environment and `fetch` are set up before the dynamic import.
 */

const ORIGIN = "http://localhost:8000"

// A minimal region map containing only Great Britain.
function mockRegionsFetch() {
  global.fetch = vi.fn(async (input) => {
    const url = String(input)
    if (url.includes("/store/regions")) {
      return Response.json({
        regions: [{ id: "reg_gb", countries: [{ iso_2: "gb" }] }],
      })
    }
    if (url.includes("/store/newsletter/confirm")) {
      return Response.json({ result: "confirmed" })
    }
    if (url.includes("/store/newsletter/unsubscribe")) {
      return Response.json({ result: "unsubscribed" })
    }
    return new Response(null, { status: 404 })
  }) as typeof fetch
}

let middleware: (request: NextRequest) => Promise<Response>
let NextRequestCtor: typeof import("next/server").NextRequest

beforeAll(async () => {
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL = "http://localhost:9000"
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test"
  process.env.NEXT_PUBLIC_DEFAULT_REGION = "gb"
  mockRegionsFetch()

  const serverMod = await import("next/server")
  NextRequestCtor = serverMod.NextRequest
  const mod = await import("./middleware")
  middleware = mod.middleware
})

function request(path: string): NextRequest {
  return new NextRequestCtor(new URL(path, ORIGIN))
}

function isRedirect(res: Response): boolean {
  return res.status >= 300 && res.status < 400 && res.headers.has("location")
}

function isPassThrough(res: Response): boolean {
  // NextResponse.next() marks the response for the app to render.
  return res.headers.get("x-middleware-next") === "1"
}

describe("country-code middleware routing", () => {
  it("redirects /coming-soon to the country-aware route", async () => {
    const res = await middleware(request("/coming-soon"))
    expect(isRedirect(res)).toBe(true)
    expect(res.headers.get("location")).toBe(`${ORIGIN}/gb/coming-soon`)
  })

  it("serves /gb/coming-soon without redirecting", async () => {
    const res = await middleware(request("/gb/coming-soon"))
    expect(isRedirect(res)).toBe(false)
    expect(isPassThrough(res)).toBe(true)
  })

  it("redirects /privacy to the country-aware route", async () => {
    const res = await middleware(request("/privacy"))
    expect(isRedirect(res)).toBe(true)
    expect(res.headers.get("location")).toBe(`${ORIGIN}/gb/privacy`)
  })

  it("serves /gb/privacy without redirecting", async () => {
    const res = await middleware(request("/gb/privacy"))
    expect(isRedirect(res)).toBe(false)
    expect(isPassThrough(res)).toBe(true)
  })

  it.each(["confirm", "unsubscribe"])(
    "processes /newsletter/%s while localising without emitting its token",
    async (action) => {
      const token = "opaque-test-token"
      const res = await middleware(
        request(`/newsletter/${action}?token=${token}`),
      )
      const location = res.headers.get("location") ?? ""
      expect(location).toContain(
        `/gb/newsletter/${action}?result=${
          action === "confirm" ? "confirmed" : "unsubscribed"
        }`,
      )
      expect(location).not.toContain(token)
    },
  )

  it.each(["confirm", "unsubscribe"])(
    "processes /gb/newsletter/%s tokens before rendering and redirects without the token",
    async (action) => {
      const token = "opaque-test-token"
      const res = await middleware(
        request(`/gb/newsletter/${action}?token=${token}`),
      )
      expect(isRedirect(res)).toBe(true)
      const location = res.headers.get("location") ?? ""
      expect(location).toContain(
        `/gb/newsletter/${action}?result=${
          action === "confirm" ? "confirmed" : "unsubscribed"
        }`,
      )
      expect(location).not.toContain(token)
      expect(res.headers.get("cache-control")).toBe("no-store")
      expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    },
  )

  it.each(["confirm", "unsubscribe"])(
    "serves a clean /gb/newsletter/%s result without another redirect",
    async (action) => {
      const res = await middleware(
        request(`/gb/newsletter/${action}?result=invalid`),
      )
      expect(isRedirect(res)).toBe(false)
      expect(isPassThrough(res)).toBe(true)
    },
  )

  it("resolves coming-soon -> privacy navigation to a real country route", async () => {
    // The coming-soon form links to `/{country}/privacy`; that target must pass
    // through the middleware (i.e. it is already a valid country route).
    const res = await middleware(request("/gb/privacy"))
    expect(isPassThrough(res)).toBe(true)
  })

  it("resolves the custom 404 return link through the middleware", async () => {
    // The global 404 links to the unprefixed `/coming-soon`; the middleware
    // localises it to the working country route.
    const res = await middleware(request("/coming-soon"))
    expect(res.headers.get("location")).toBe(`${ORIGIN}/gb/coming-soon`)
  })

  it("passes a genuinely missing country-prefixed path through to a 404 render", async () => {
    // The middleware does not itself 404; it hands off to the app, which
    // renders the not-found page. That final HTTP 404 depends on the app
    // router actually running, which this unit-level test cannot exercise —
    // it is verified over real HTTP by `scripts/verify-final-404.mjs`
    // (`pnpm run verify:404`). This test only proves the middleware does NOT
    // redirect a path that already has a valid country prefix.
    const res = await middleware(request("/gb/does-not-exist"))
    expect(isRedirect(res)).toBe(false)
    expect(isPassThrough(res)).toBe(true)
  })
})
