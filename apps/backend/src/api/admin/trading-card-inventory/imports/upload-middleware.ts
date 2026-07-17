import multer from "multer"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PULSE_FILE_LIMITS } from "../../../../modules/trading-card-inventory/pulse/types"

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 8,
    parts: 9,
    fieldSize: 1_024,
    fieldNameSize: 64,
    headerPairs: 32,
  },
}).single("file")

/**
 * Stage 5B.1 Slice 3: bounded, in-memory-only multipart intake for the Pulse
 * CSV upload route. This is deliberately the *only* job of this middleware —
 * bound the request size and shape a clean JSON error if Multer rejects it
 * (oversized file, unexpected field). It never re-validates CSV content,
 * extension or MIME type; `validatePulseFile` inside the import workflow
 * remains the sole authority for that. No temp file, no filesystem path, no
 * R2 — the buffer stays in process memory until the workflow consumes it.
 */
export function pulseCsvUploadMiddleware(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  upload(req as never, res as never, (error: unknown) => {
    if (!error) {
      next()
      return
    }
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400
      res.status(status).json({ message: "The uploaded file could not be accepted", code: error.code })
      return
    }
    res.status(400).json({ message: "The uploaded file could not be accepted" })
  })
}
