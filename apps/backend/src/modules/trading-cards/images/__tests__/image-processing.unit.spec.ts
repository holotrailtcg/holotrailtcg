import sharp from "sharp"
import { processCardImageUpload } from "../image-processing"

async function buildJpeg(input: { width?: number; height?: number; exifOrientation?: number } = {}): Promise<Buffer> {
  const { width = 4, height = 4, exifOrientation } = input
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).jpeg()
  if (exifOrientation) {
    pipeline = pipeline.withMetadata({ orientation: exifOrientation })
  }
  return pipeline.toBuffer()
}

async function buildPngWithAlpha(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  }).png().toBuffer()
}

async function buildWebpWithAlpha(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  }).webp().toBuffer()
}

describe("processCardImageUpload", () => {
  it("accepts a valid JPEG and reports correct mime/dimensions/hash", async () => {
    const bytes = await buildJpeg({ width: 6, height: 4 })
    const outcome = await processCardImageUpload(bytes)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.mimeType).toBe("image/jpeg")
    expect(outcome.result.width).toBe(6)
    expect(outcome.result.height).toBe(4)
    expect(outcome.result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(outcome.result.byteSize).toBe(outcome.result.buffer.length)
  })

  it("accepts a valid PNG and preserves its alpha channel", async () => {
    const bytes = await buildPngWithAlpha()
    const outcome = await processCardImageUpload(bytes)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.mimeType).toBe("image/png")
    const outputMetadata = await sharp(outcome.result.buffer).metadata()
    expect(outputMetadata.hasAlpha).toBe(true)
    expect(outputMetadata.channels).toBe(4)
  })

  it("accepts a valid WEBP and preserves its alpha channel", async () => {
    const bytes = await buildWebpWithAlpha()
    const outcome = await processCardImageUpload(bytes)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.mimeType).toBe("image/webp")
    const outputMetadata = await sharp(outcome.result.buffer).metadata()
    expect(outputMetadata.hasAlpha).toBe(true)
  })

  it("is declared-type-agnostic: a PNG confirms as image/png regardless of any assumed extension", async () => {
    const bytes = await buildPngWithAlpha()
    const outcome = await processCardImageUpload(bytes)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.mimeType).toBe("image/png")
  })

  it("rejects an SVG (unsupported format) even though it is a valid, well-formed file", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>')
    const outcome = await processCardImageUpload(svg)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toMatch(/^unsupported-format/)
  })

  it("rejects a corrupted/truncated buffer", async () => {
    const validJpeg = await buildJpeg()
    const truncated = validJpeg.subarray(0, 20)
    const outcome = await processCardImageUpload(truncated)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe("corrupted-or-unreadable")
  })

  it("rejects arbitrary non-image bytes", async () => {
    const garbage = Buffer.from("this is not an image at all, just some plain text bytes")
    const outcome = await processCardImageUpload(garbage)
    expect(outcome.ok).toBe(false)
  })

  it("strips EXIF/orientation metadata from the output", async () => {
    const bytes = await buildJpeg({ width: 4, height: 8, exifOrientation: 6 })
    const inputMetadata = await sharp(bytes).metadata()
    expect(inputMetadata.orientation).toBe(6)

    const outcome = await processCardImageUpload(bytes)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const outputMetadata = await sharp(outcome.result.buffer).metadata()
    expect(outputMetadata.exif).toBeUndefined()
    expect(outputMetadata.orientation).toBeUndefined()
  })

  it("auto-orients from EXIF, swapping width/height for a 90-degree rotation", async () => {
    const bytes = await buildJpeg({ width: 4, height: 8, exifOrientation: 6 })
    const outcome = await processCardImageUpload(bytes)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.width).toBe(8)
    expect(outcome.result.height).toBe(4)
  })

  it("is deterministic: identical input bytes produce an identical output hash", async () => {
    const bytes = await buildJpeg({ width: 5, height: 5 })
    const first = await processCardImageUpload(bytes)
    const second = await processCardImageUpload(bytes)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.result.sha256).toBe(second.result.sha256)
    expect(first.result.buffer.equals(second.result.buffer)).toBe(true)
  })
})
