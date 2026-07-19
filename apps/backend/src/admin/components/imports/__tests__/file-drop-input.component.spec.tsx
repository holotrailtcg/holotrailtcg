/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FileDropInput } from "../file-drop-input"

function csvFile(name = "import.csv"): File {
  return new File(["a,b\n1,2"], name, { type: "text/csv" })
}

describe("FileDropInput", () => {
  it("shows the label and hint when no file is chosen", () => {
    render(
      <FileDropInput
        label="Choose a CSV file, or drag and drop"
        hint="CSV files only, up to 10 MB."
        accept=".csv"
        ariaLabel="Pulse CSV file"
        value={null}
        onChange={jest.fn()}
      />
    )

    expect(screen.getByText("Choose a CSV file, or drag and drop")).toBeInTheDocument()
    expect(screen.getByText("CSV files only, up to 10 MB.")).toBeInTheDocument()
    expect(screen.queryByText("Remove file")).not.toBeInTheDocument()
  })

  it("opens the native file picker when the drop zone is clicked", async () => {
    const user = userEvent.setup()
    render(
      <FileDropInput
        label="Choose a CSV file, or drag and drop"
        accept=".csv"
        ariaLabel="Pulse CSV file"
        value={null}
        onChange={jest.fn()}
      />
    )

    const input = screen.getByLabelText("Pulse CSV file") as HTMLInputElement
    const clickSpy = jest.spyOn(input, "click")
    await user.click(screen.getByRole("button", { name: /Choose a CSV file/ }))

    expect(clickSpy).toHaveBeenCalled()
  })

  it("reports the chosen file via the hidden input and shows its name plus a remove action", async () => {
    const onChange = jest.fn()
    const user = userEvent.setup()
    render(
      <FileDropInput
        label="Choose a CSV file, or drag and drop"
        accept=".csv"
        ariaLabel="Pulse CSV file"
        value={null}
        onChange={onChange}
      />
    )

    await user.upload(screen.getByLabelText("Pulse CSV file"), csvFile())
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "import.csv" }))
  })

  it("shows the selected file name and lets it be cleared", async () => {
    const onChange = jest.fn()
    const user = userEvent.setup()
    render(
      <FileDropInput
        label="Choose a CSV file, or drag and drop"
        accept=".csv"
        ariaLabel="Pulse CSV file"
        value={csvFile()}
        onChange={onChange}
      />
    )

    expect(screen.getByText("import.csv")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Remove file" }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("reports a dropped file without opening the native file picker", () => {
    const onChange = jest.fn()
    render(
      <FileDropInput
        label="Choose a CSV file, or drag and drop"
        accept=".csv"
        ariaLabel="Pulse CSV file"
        value={null}
        onChange={onChange}
      />
    )

    const dropZone = screen.getByRole("button", { name: /Choose a CSV file/ })
    const file = csvFile("dropped.csv")
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "dropped.csv" }))
  })

  it("does not open the file picker or accept a drop while disabled", () => {
    const onChange = jest.fn()
    render(
      <FileDropInput
        label="Choose a CSV file, or drag and drop"
        accept=".csv"
        ariaLabel="Pulse CSV file"
        value={null}
        onChange={onChange}
        disabled
      />
    )

    const dropZone = screen.getByRole("button", { name: /Choose a CSV file/ })
    expect(dropZone).toBeDisabled()

    fireEvent.drop(dropZone, { dataTransfer: { files: [csvFile()] } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
