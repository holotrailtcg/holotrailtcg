/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import FocalPositionSelector from "../focal-position-selector"

describe("FocalPositionSelector", () => {
  it("renders all nine positions with an accessible label", () => {
    render(<FocalPositionSelector value={{ x: 0.5, y: 0.5 }} onChange={() => {}} />)
    for (const label of [
      "Top left", "Top centre", "Top right",
      "Centre left", "Centre right",
      "Bottom left", "Bottom centre", "Bottom right",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
  })

  it("marks the current value as pressed, using more than colour to convey status", () => {
    render(<FocalPositionSelector value={{ x: 0, y: 0 }} onChange={() => {}} />)
    const topLeft = screen.getByRole("button", { name: /Top left/ })
    expect(topLeft).toHaveAttribute("aria-pressed", "true")
    expect(topLeft).toHaveTextContent("(selected)")
    const topRight = screen.getByRole("button", { name: "Top right" })
    expect(topRight).toHaveAttribute("aria-pressed", "false")
  })

  it("calls onChange with the clicked position", async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<FocalPositionSelector value={{ x: 0.5, y: 0.5 }} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "Bottom right" }))
    expect(onChange).toHaveBeenCalledWith({ x: 1, y: 1 })
  })
})
