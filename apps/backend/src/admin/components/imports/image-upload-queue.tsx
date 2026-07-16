import { Container } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import type { CardImageDto } from "./image-types"
import { UploadQueueController, type QueueRow } from "./upload-queue-controller"
import UploadProgressRow from "./upload-progress-row"

interface ImageUploadQueueProps {
  variantId: string
  files: File[]
  onUploaded: (image: CardImageDto) => void
  onSettled?: () => void
}

/** Owns the concurrency-limited upload pipeline: validate, begin upload, upload to R2, confirm. */
const ImageUploadQueue = ({ variantId, files, onUploaded, onSettled }: ImageUploadQueueProps) => {
  const [rows, setRows] = useState<QueueRow[]>([])
  const onUploadedRef = useRef(onUploaded)
  onUploadedRef.current = onUploaded
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  useEffect(() => {
    if (files.length === 0) {
      setRows([])
      return
    }

    // A new batch always gets its own controller. React runs this effect's
    // cleanup (which cancels the previous batch's controller and aborts its
    // XHRs) before this body runs again, so two controllers' uploads can
    // never overlap.
    const controller = new UploadQueueController(variantId, files, {
      onRowsChange: setRows,
      onUploaded: (image) => onUploadedRef.current(image),
      onSettled: () => onSettledRef.current?.(),
    })
    controller.start()

    return () => {
      controller.cancel()
    }
  }, [files, variantId])

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
