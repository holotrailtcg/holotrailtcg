import { Text, clx } from "@medusajs/ui"
import { ChangeEvent, DragEvent, MouseEvent, useRef, useState } from "react"

/**
 * Styled single-file picker: a dashed drop zone that also opens the native
 * file dialog on click, backed by a visually hidden (not display:none)
 * native `<input type="file">` so screen readers and keyboard users still
 * get standard file-input behaviour. Mirrors the pattern Medusa's own
 * Admin dashboard uses for its `FileUpload` component
 * (@medusajs/dashboard/src/components/common/file-upload), adapted here
 * for a single required file rather than a multi-file queue.
 */
export interface FileDropInputProps {
  label: string
  hint?: string
  accept: string
  ariaLabel: string
  value: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
  hasError?: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export const FileDropInput = ({
  label,
  hint,
  accept,
  ariaLabel,
  value,
  onChange,
  disabled = false,
  hasError = false,
}: FileDropInputProps) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLButtonElement>(null)

  const openFilePicker = () => {
    if (!disabled) inputRef.current?.click()
  }

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (disabled) return
    setIsDragOver(true)
  }

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!dropZoneRef.current || dropZoneRef.current.contains(event.relatedTarget as Node)) {
      return
    }
    setIsDragOver(false)
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    if (disabled) return
    const droppedFile = event.dataTransfer?.files?.[0] ?? null
    onChange(droppedFile)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.files?.[0] ?? null)
  }

  const handleClear = (event: MouseEvent) => {
    event.stopPropagation()
    onChange(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-y-1">
      <button
        ref={dropZoneRef}
        type="button"
        disabled={disabled}
        onClick={openFilePicker}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        className={clx(
          "bg-ui-bg-component border-ui-border-strong transition-fg group flex w-full flex-col items-center gap-y-1 border border-dashed p-6 text-center",
          "hover:border-ui-border-interactive focus:border-ui-border-interactive",
          "focus:shadow-borders-focus outline-none focus:border-solid",
          "disabled:cursor-not-allowed disabled:opacity-50",
          {
            "!border-ui-border-error": hasError,
            "!border-ui-border-interactive": isDragOver,
          }
        )}
      >
        <Text size="small" weight="plus" className="text-ui-fg-base">
          {value ? value.name : label}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {value ? `${formatFileSize(value.size)} — click or drop to replace` : hint}
        </Text>
      </button>

      {value && (
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled}
          className="text-ui-fg-subtle hover:text-ui-fg-base w-fit text-xs underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Remove file
        </button>
      )}

      <input
        ref={inputRef}
        hidden
        type="file"
        accept={accept}
        aria-label={ariaLabel}
        onChange={handleFileChange}
        disabled={disabled}
      />
    </div>
  )
}

export default FileDropInput
