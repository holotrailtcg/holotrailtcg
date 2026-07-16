import { Text } from "@medusajs/ui"

export type UploadRowState = "queued" | "uploading" | "confirming" | "success" | "error"

export interface UploadProgressRowProps {
  fileName: string
  state: UploadRowState
  progress: number
  errorMessage?: string
}

const STATE_LABEL: Record<UploadRowState, string> = {
  queued: "Waiting to upload",
  uploading: "Uploading",
  confirming: "Confirming…",
  success: "Uploaded",
  error: "Upload failed",
}

const UploadProgressRow = ({ fileName, state, progress, errorMessage }: UploadProgressRowProps) => {
  const percent = Math.round(progress * 100)

  return (
    <div className="flex flex-col gap-1 border-b p-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <Text size="small">{fileName}</Text>
        <Text size="xsmall" className={state === "error" ? "text-ui-fg-error" : "text-ui-fg-subtle"}>
          {STATE_LABEL[state]}
          {state === "uploading" ? ` (${percent}%)` : ""}
        </Text>
      </div>
      {state === "uploading" && (
        <div className="h-1 w-full bg-ui-bg-subtle" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1 bg-ui-fg-interactive" style={{ width: `${percent}%` }} />
        </div>
      )}
      {state === "error" && errorMessage && (
        <Text size="xsmall" className="text-ui-fg-error">
          {errorMessage}
        </Text>
      )}
    </div>
  )
}

export default UploadProgressRow
