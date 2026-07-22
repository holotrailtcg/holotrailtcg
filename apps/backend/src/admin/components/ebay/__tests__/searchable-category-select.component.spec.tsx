/** @jest-environment jsdom */
import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { SearchableCategorySelect } from "../searchable-category-select"
import type { StoreCategoryLike } from "../category-tree"

function category(overrides: Partial<StoreCategoryLike>): StoreCategoryLike {
  return {
    id: overrides.id ?? "cat_1", externalId: overrides.externalId ?? "ext_1", name: overrides.name ?? "Category",
    parentExternalId: overrides.parentExternalId ?? null, siblingOrder: overrides.siblingOrder ?? 0,
    level: overrides.level ?? 1, path: overrides.path ?? overrides.name ?? "Category", status: overrides.status ?? "ACTIVE",
  }
}

const CATEGORIES: StoreCategoryLike[] = [
  category({ id: "cat_1", externalId: "1", name: "Pokemon", path: "Pokemon", siblingOrder: 1 }),
  category({ id: "cat_2", externalId: "2", name: "Scarlet & Violet", parentExternalId: "1", path: "Pokemon > Scarlet & Violet", siblingOrder: 1 }),
  category({ id: "cat_3", externalId: "3", name: "Sword & Shield", parentExternalId: "1", path: "Pokemon > Sword & Shield", siblingOrder: 2 }),
  category({ id: "cat_removed", externalId: "4", name: "Discontinued", status: "REMOVED", path: "Discontinued", siblingOrder: 3 }),
]

// Wraps the (controlled) component so a selection is reflected back into
// `value`, matching how a real parent (e.g. CategoryAssignmentDialog) uses
// it — the component's own displayed text depends on `value` resolving back
// to a label once the dropdown closes.
function ControlledSelect({ initialValue = "", onChange }: { initialValue?: string; onChange: (id: string) => void }) {
  const [value, setValue] = useState(initialValue)
  return (
    <SearchableCategorySelect
      id="cat-select" ariaLabel="Category" categories={CATEGORIES} value={value}
      onChange={(id) => { setValue(id); onChange(id) }}
    />
  )
}

function renderSelect(initialValue = "", onChange = jest.fn()) {
  render(<ControlledSelect initialValue={initialValue} onChange={onChange} />)
  return { onChange }
}

describe("SearchableCategorySelect", () => {
  it("opens the dropdown listing only ACTIVE categories, indented parents-before-children", async () => {
    const user = userEvent.setup()
    renderSelect()
    await user.click(screen.getByRole("combobox", { name: "Category" }))

    const options = screen.getAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual(["Pokemon", "Scarlet & Violet", "Sword & Shield"])
    expect(screen.queryByText("Discontinued")).not.toBeInTheDocument()
  })

  it("filters options by typed text, matching on name or full path", async () => {
    const user = userEvent.setup()
    renderSelect()
    const input = screen.getByRole("combobox", { name: "Category" })
    await user.click(input)
    await user.type(input, "sword")

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Sword & Shield"])
  })

  it("shows a 'no categories match' message when the filter matches nothing", async () => {
    const user = userEvent.setup()
    renderSelect()
    const input = screen.getByRole("combobox", { name: "Category" })
    await user.click(input)
    await user.type(input, "nonexistent-category-xyz")

    expect(screen.getByText("No categories match.")).toBeInTheDocument()
  })

  it("moves the highlighted option with ArrowDown/ArrowUp and selects it with Enter", async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect()
    const input = screen.getByRole("combobox", { name: "Category" })
    await user.click(input)

    await user.keyboard("{ArrowDown}{ArrowDown}")
    await user.keyboard("{Enter}")

    expect(onChange).toHaveBeenCalledWith("cat_3")
    expect(input).toHaveValue("Sword & Shield")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("selects an option directly by clicking it", async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect()
    await user.click(screen.getByRole("combobox", { name: "Category" }))
    await user.click(screen.getByRole("option", { name: "Scarlet & Violet" }))

    expect(onChange).toHaveBeenCalledWith("cat_2")
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Scarlet & Violet")
  })

  it("closes the dropdown and reverts to the selected label on Escape", async () => {
    const user = userEvent.setup()
    renderSelect("cat_1")
    const input = screen.getByRole("combobox", { name: "Category" })
    await user.click(input)
    await user.type(input, "sword")
    await user.keyboard("{Escape}")

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(input).toHaveValue("Pokemon")
  })

  it("closes the dropdown on an outside click, without changing the selection", async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect()
    render(<button type="button">Outside</button>)
    await user.click(screen.getByRole("combobox", { name: "Category" }))
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Outside" }))

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
