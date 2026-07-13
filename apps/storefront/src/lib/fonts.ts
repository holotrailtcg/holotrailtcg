import { Barlow_Condensed, Source_Sans_3 } from "next/font/google"

/**
 * Holo Trail TCG global typefaces (Brand Guidelines v3).
 *
 * Loaded once here and applied on <html> in the root layout so every route
 * shares the same fonts with no per-page loading and no layout shift.
 *
 * - Source Sans 3  -> body and interface text (global default)   --font-body
 * - Barlow Condensed -> display text and headings                 --font-display
 *
 * `display: "swap"` plus system fallbacks keep text visible during load.
 */

export const fontBody = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
  weight: ["400", "600", "700"],
  fallback: [
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
})

export const fontDisplay = Barlow_Condensed({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["500", "600", "700"],
  fallback: [
    "Arial Narrow",
    "Helvetica Neue",
    "Helvetica",
    "Arial",
    "sans-serif",
  ],
})
