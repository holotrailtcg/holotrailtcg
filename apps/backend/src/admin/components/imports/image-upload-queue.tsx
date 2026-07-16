import { Container } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { postAction } from "./fetch-json"
import type { BeginUploadResponse, CardImageDto } from "./image-types"
import { MAX_CONCURRENT_UPLOADS, uploadToR2, validateFileForUpload } from "./upload-to-r2"
import UploadProgressRow, { type UploadRowState } from "./upload-progress-row"

interface QueueRow {
  key: string
  file: File
  state: UploadRowState
  progress: number
  errorMessage?: string
}

interface ImageUploadQueueProps {
  variantId: string
  files: File[]
  onUploaded: (image: CardImageDto) => void
  onSettled?: () => void
}

async function uploadOne(
  variantId: string,
  file: File,
  onProgress: (progress: number) => void
): Promise<CardImageDto> {
  const begin = await postAction<BeginUploadResponse>(
    `/admin/trading-cards/variants/${encodeURIComponent(variantId)}/images/upload`,
    { originalFilename: file.name, declaredMimeType: file.type, declaredByteSize: file.size }
  )
  await uploadToR2({
    uploadUrl: begin.uploadUrl, requiredHeaders: begin.requiredHeaders, file, onProgress,
  })
  return postAction<CardImageDto>(`/admin/trading-cards/images/${encodeURIComponent(begin.imageId)}/confirm`)
}

/** Owns the concurrency-limited upload pipeline: validate, begin upload, upload to R2, confirm. */
const ImageUploadQueue = ({ variantId, files, onUploaded, onSettled }: ImageUploadQueueProps) => {
  const [rows, setRows] = useState<QueueRow[]>([])
  const onUploadedRef = useRef(onUploaded)
  onUploadedRef.current = onUploaded
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  useEffect(() => {
    if (files.length === 0) return

    const initialRows: QueueRow[] = files.map((file, index) => ({
      key: `${file.name}-${index}-${Date.now()}`, file, state: "queued", progress: 0,
    }))
    setRows(initialRows)

    const updateRow = (key: string, patch: Partial<QueueRow>) => {
      setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    }

    let cancelled = false
    let nextIndex = 0

    async function worker() {
      while (!cancelled) {
        const index = nextIndex
        nextIndex += 1
        if (index >= initialRows.length) return
        const row = initialRows[index]

        const validation = validateFileForUpload(row.file)
        if (!validation.valid) {
          updateRow(row.key, { state: "error", errorMessage: validation.reason })
          continue
        }

        updateRow(row.key, { state: "uploading", progress: 0 })
        try {
          const image = await uploadOne(variantId, row.file, (progress) => updateRow(row.key, { progress }))
          if (!cancelled) {
            updateRow(row.key, { state: "success", progress: 1 })
            onUploadedRef.current(image)
          }
        } catch {
          if (!cancelled) {
            updateRow(row.key, { state: "error", errorMessage: "This image could not be uploaded. Please try again." })
          }
        }
      }
    }

    const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, initialRows.length)
    Promise.all(Array.from({ length: workerCount }, () => worker())).then(() => {
      if (!cancelled) onSettledRef.current?.()
    })

    return () => {
      cancelled = true
    }
    // Deliberately keyed only on `files`: this effect starts one pipeline per new upload batch.
  }, [files])

  if (rows.length === 0) return null

  return (
    <Container className="divide-y p-0">
      {rows.map((row) => (
        <UploadProgressRow
          key={row.key}
          fileName={row.file.name}
          state={row.state}
          progress={row.progress}
          errorMessage={row.errorMessage}
        />
      ))}
    </Container>
  )
}

export default ImageUploadQueue
