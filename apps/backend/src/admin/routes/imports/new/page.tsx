import { Button, Container, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import ImportStepper from "../../../components/imports/import-stepper"
import SourceSelect from "../../../components/imports/source-select"
import { PULSE_UPLOAD_MAX_BYTE_SIZE, uploadCsv } from "../../../components/imports/upload-csv"
import type { UploadCsvResult } from "../../../components/imports/pulse-import-types"
import "../../../styles/imports.css"

type SourceMode = "existing" | "new"

const NEW_SOURCE_PROVIDER_OPTIONS = [
  { value: "PULSE", label: "Pulse" },
  { value: "OTHER", label: "Other" },
]

const NEW_SOURCE_LANGUAGE_OPTIONS = [
  { value: "EN", label: "English" },
  { value: "JA", label: "Japanese" },
  { value: "ZH", label: "Chinese" },
]

const ImportsNewPage = () => {
  const navigate = useNavigate()
  const [sourceMode, setSourceMode] = useState<SourceMode>("existing")
  const [inventorySourceId, setInventorySourceId] = useState("")
  const [newSourceDisplayName, setNewSourceDisplayName] = useState("")
  const [newSourceProvider, setNewSourceProvider] = useState("PULSE")
  const [newSourceLanguage, setNewSourceLanguage] = useState("")
  const [newSourceDefaultCurrencyCode, setNewSourceDefaultCurrencyCode] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canSubmit =
    Boolean(file) &&
    !isUploading &&
    (sourceMode === "existing" ? Boolean(inventorySourceId) : Boolean(newSourceDisplayName.trim() && newSourceProvider))

  const handleSubmit = async () => {
    if (!file) return
    setIsUploading(true)
    setProgress(0)
    setErrorMessage(null)
    try {
      const { status, body } = await uploadCsv({
        file,
        fields:
          sourceMode === "existing"
            ? { inventorySourceId }
            : {
                newSourceDisplayName: newSourceDisplayName.trim(),
                newSourceProvider,
                newSourceLanguage: newSourceLanguage || undefined,
                newSourceDefaultCurrencyCode: newSourceDefaultCurrencyCode.trim() || undefined,
              },
        onProgress: setProgress,
      })
      const result = body as UploadCsvResult | null

      if (status >= 500 || !result) {
        setErrorMessage("The import could not be completed. Please try again.")
        return
      }

      switch (result.kind) {
        case "IMPORTED":
          toast.success("Import complete", { description: `${result.importSummary.rowCount} rows processed.` })
          navigate(`/imports/snapshots/${result.snapshotId}`)
          return
        case "DUPLICATE":
          toast.info("This file has already been imported", { description: "Showing the existing snapshot." })
          navigate(`/imports/snapshots/${result.snapshotId}`)
          return
        case "VALIDATION_FAILED":
          setErrorMessage(result.reason)
          return
        case "NO_USABLE_ROWS":
          setErrorMessage("None of the rows in this file could be used. Check the file and try again.")
          return
        case "SOURCE_ARCHIVED":
          setErrorMessage("This inventory source is archived and cannot receive new imports.")
          return
        default:
          setErrorMessage("The import could not be completed. Please try again.")
      }
    } catch {
      setErrorMessage("The upload failed. Check your connection and try again.")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="ht-imports flex flex-col gap-6">
      <Container className="flex flex-col gap-4 p-6">
        <Heading level="h1">Upload and import</Heading>
        <ImportStepper compact />
        <Text size="small" className="text-ui-fg-subtle">
          Upload a Pulse CSV file and start an import. You will see a preview before anything changes.
        </Text>

        <div className="flex flex-col gap-4 sm:max-w-md">
          <div className="flex gap-2">
            <Button
              size="small"
              variant={sourceMode === "existing" ? "primary" : "secondary"}
              onClick={() => setSourceMode("existing")}
              disabled={isUploading}
            >
              Existing source
            </Button>
            <Button
              size="small"
              variant={sourceMode === "new" ? "primary" : "secondary"}
              onClick={() => setSourceMode("new")}
              disabled={isUploading}
            >
              Create new source
            </Button>
          </div>

          {sourceMode === "existing" ? (
            <SourceSelect value={inventorySourceId} onChange={setInventorySourceId} />
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                aria-label="Source name"
                placeholder="Source name (e.g. Pulse export — July 2026)"
                value={newSourceDisplayName}
                onChange={(event) => setNewSourceDisplayName(event.target.value)}
                disabled={isUploading}
              />
              <Select value={newSourceProvider} onValueChange={setNewSourceProvider}>
                <Select.Trigger aria-label="Provider">
                  <Select.Value placeholder="Provider" />
                </Select.Trigger>
                <Select.Content>
                  {NEW_SOURCE_PROVIDER_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Select value={newSourceLanguage} onValueChange={setNewSourceLanguage}>
                <Select.Trigger aria-label="Language (optional)">
                  <Select.Value placeholder="Language (optional)" />
                </Select.Trigger>
                <Select.Content>
                  {NEW_SOURCE_LANGUAGE_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Input
                aria-label="Default currency code (optional)"
                placeholder="Default currency code (optional, e.g. GBP)"
                value={newSourceDefaultCurrencyCode}
                onChange={(event) => setNewSourceDefaultCurrencyCode(event.target.value.toUpperCase())}
                maxLength={3}
                disabled={isUploading}
              />
            </div>
          )}

          <input
            type="file"
            accept=".csv"
            aria-label="Pulse CSV file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={isUploading}
          />
          <Text size="xsmall" className="text-ui-fg-subtle">
            CSV files only, up to {Math.round(PULSE_UPLOAD_MAX_BYTE_SIZE / (1024 * 1024))} MB.
          </Text>

          {isUploading && (
            <div className="h-1 w-full bg-ui-bg-subtle" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-1 bg-ui-fg-interactive" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}

          {errorMessage && (
            <Text size="small" className="text-ui-fg-error" role="alert">
              {errorMessage}
            </Text>
          )}

          <Button onClick={handleSubmit} disabled={!canSubmit} isLoading={isUploading}>
            Upload and import
          </Button>
        </div>

        <Text size="small">
          <Link to="/imports">Back to imports</Link>
        </Text>
      </Container>
    </div>
  )
}

export default ImportsNewPage
