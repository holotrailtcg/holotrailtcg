import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Checkbox } from "./checkbox"

/**
 * Static class/CSS contract check (no jsdom/RTL): forced-colors mode cannot be
 * simulated in a DOM test environment, so this asserts the checkbox actually
 * ships the `forced-colors:` rules that make the checked state visible under a
 * system high-contrast palette, rather than relying solely on the white SVG
 * check mark over an author-controlled background.
 */
function renderClassName(props: React.ComponentProps<typeof Checkbox> = {}) {
  const html = renderToStaticMarkup(React.createElement(Checkbox, props))
  const match = html.match(/class="([^"]*)"/)
  if (!match) throw new Error("Checkbox did not render a class attribute")
  return match[1]
}

describe("Checkbox forced-colors contract", () => {
  it("restores native appearance under forced-colors so the OS renders its own checked indicator", () => {
    const className = renderClassName()
    expect(className).toContain("forced-colors:appearance-auto")
  })

  it("does not rely on the custom SVG background-image under forced-colors", () => {
    const className = renderClassName()
    expect(className).toContain("forced-colors:[background-image:none]")
    expect(className).toContain("forced-colors:checked:[background-image:none]")
  })

  it("still preserves the square Holo Trail styling and custom check icon in normal mode", () => {
    const className = renderClassName()
    expect(className).toContain("rounded-none")
    expect(className).toContain("checked:[background-image:var(--ht-checkbox-check)]")
  })

  it("preserves visible focus and disabled styling", () => {
    const className = renderClassName()
    expect(className).toContain("focus-visible:ring-2")
    expect(className).toContain("disabled:cursor-not-allowed")
    expect(className).toContain("disabled:opacity-50")
  })

  it("renders a real native checkbox input for keyboard, form and screen-reader semantics", () => {
    const html = renderToStaticMarkup(React.createElement(Checkbox, {}))
    expect(html).toContain('type="checkbox"')
  })
})
