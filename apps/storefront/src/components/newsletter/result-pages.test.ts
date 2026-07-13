import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import ConfirmPage, {
  dynamic as confirmDynamic,
  metadata as confirmMetadata,
  revalidate as confirmRevalidate,
} from "../../app/[countryCode]/newsletter/confirm/page"
import UnsubscribePage, {
  dynamic as unsubscribeDynamic,
  metadata as unsubscribeMetadata,
  revalidate as unsubscribeRevalidate,
} from "../../app/[countryCode]/newsletter/unsubscribe/page"
import { NewsletterResultView, NewsletterProcessingView } from "./result-view"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("confirmation result page", () => {
  it.each([
    ["confirmed", "Your email is confirmed"],
    ["already_confirmed", "Your email is already confirmed"],
    ["invalid_or_expired", "This confirmation link is no longer valid"],
    ["temporary_error", "We could not confirm your email"],
  ] as const)(
    "renders %s with an h1 and country-aware return link",
    (result, heading) => {
      const html = renderToStaticMarkup(
        React.createElement(NewsletterResultView, {
          countryCode: "gb",
          type: "confirmation",
          result,
        }),
      )
      expect(html).toContain(`<h1`)
      expect(html).toContain(heading)
      expect(html).toContain('href="/gb/coming-soon"')
      expect(html).toContain('aria-live="polite"')
    },
  )

  it("processes on the server without rendering or passing the token to cleanup", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "https://backend.example")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "pk_test")
    const token = "opaque-confirmation-token"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ result: "confirmed" })),
    )
    const element = await ConfirmPage({
      params: Promise.resolve({ countryCode: "gb" }),
      searchParams: Promise.resolve({ token }),
    })
    const html = renderToStaticMarkup(element)
    expect(html).toContain("Your email is confirmed")
    expect(html).not.toContain(token)
    const children = React.Children.toArray(
      element.props.children,
    ) as React.ReactElement[]
    expect(children[1].props).toEqual({
      cleanPathname: "/gb/newsletter/confirm",
    })
    expect(JSON.stringify(children[1].props)).not.toContain(token)
  })

  it("is noindex, no-referrer, and force-dynamic/no-store", () => {
    expect(confirmMetadata.robots).toEqual({ index: false, follow: false })
    expect(confirmMetadata.referrer).toBe("no-referrer")
    expect(confirmDynamic).toBe("force-dynamic")
    expect(confirmRevalidate).toBe(0)
  })
})

describe("unsubscribe result page", () => {
  it.each([
    ["unsubscribed", "You have been unsubscribed"],
    ["already_unsubscribed", "You are already unsubscribed"],
    ["invalid", "This unsubscribe link is not valid"],
    ["temporary_error", "We could not update your subscription"],
  ] as const)(
    "renders %s with an accessible country-aware view",
    (result, heading) => {
      const html = renderToStaticMarkup(
        React.createElement(NewsletterResultView, {
          countryCode: "gb",
          type: "unsubscribe",
          result,
        }),
      )
      expect(html).toContain("<h1")
      expect(html).toContain(heading)
      expect(html).toContain('href="/gb/coming-soon"')
      expect(html).toContain('aria-live="polite"')
    },
  )

  it("processes on the server and gives cleanup only the clean path", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", "https://backend.example")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "pk_test")
    const token = "opaque-unsubscribe-token"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ result: "unsubscribed" })),
    )
    const element = await UnsubscribePage({
      params: Promise.resolve({ countryCode: "gb" }),
      searchParams: Promise.resolve({ token }),
    })
    const html = renderToStaticMarkup(element)
    expect(html).toContain("You have been unsubscribed")
    expect(html).not.toContain(token)
    const children = React.Children.toArray(
      element.props.children,
    ) as React.ReactElement[]
    expect(children[1].props).toEqual({
      cleanPathname: "/gb/newsletter/unsubscribe",
    })
  })

  it("is noindex, no-referrer, and force-dynamic/no-store", () => {
    expect(unsubscribeMetadata.robots).toEqual({ index: false, follow: false })
    expect(unsubscribeMetadata.referrer).toBe("no-referrer")
    expect(unsubscribeDynamic).toBe("force-dynamic")
    expect(unsubscribeRevalidate).toBe(0)
  })
})

it("provides an accessible processing state", () => {
  const html = renderToStaticMarkup(
    React.createElement(NewsletterProcessingView),
  )
  expect(html).toContain("<h1")
  expect(html).toContain("Processing your request")
  expect(html).toContain('aria-live="polite"')
})
