import { describe, expect, it } from "vitest"

import { isStaticAssetPath } from "./static-assets"

describe("isStaticAssetPath", () => {
  it.each([
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/opengraph-image.jpg",
    "/twitter-image.jpg",
    "/brand/holotrailtcg-full-logo.png",
    "/energy-icons/fire.png",
    "/favicon_io/favicon.ico",
    "/images/akin-cakiner-9cIkK-hLD9k-unsplash.jpg",
    "/rarity-icons/common.png",
    "/variant-icons/arenaCup.png",
  ])("matches the real static asset path %s", (pathname) => {
    expect(isStaticAssetPath(pathname)).toBe(true)
  })

  it.each([
    "/gb/images/x.png",
    "/gb/robots.txt",
    "/gb/sitemap.xml",
    "/products/card.v2",
    "/gb/products/card.v2",
    "/images",
    "/images/",
    "/imagesx/y.png",
    "/gb/brand/logo.png",
    "/order/order_123/transfer/a.b.c",
  ])("does not match the application path %s", (pathname) => {
    expect(isStaticAssetPath(pathname)).toBe(false)
  })
})
