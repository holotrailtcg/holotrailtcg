import { decodeUtf8Strict, validateHeaders } from "../csv-format"
import { PULSE_EXPECTED_HEADERS, PULSE_OPTIONAL_HEADERS } from "../types"

describe("decodeUtf8Strict", () => {
  it("decodes plain UTF-8 and strips an optional BOM", () => {
    expect(decodeUtf8Strict(Buffer.from("hello", "utf8"))).toBe("hello")
    expect(decodeUtf8Strict(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello", "utf8")]))).toBe("hello")
  })

  it("rejects null bytes and undecodable byte sequences", () => {
    expect(() => decodeUtf8Strict(Buffer.from([0x68, 0x00, 0x69]))).toThrow(/null bytes/)
    expect(() => decodeUtf8Strict(Buffer.from([0xff, 0xfe, 0x41, 0x42]))).toThrow(/UTF-8/)
  })

  it("rejects a file larger than the maximum allowed size", () => {
    expect(() => decodeUtf8Strict(Buffer.alloc(10 * 1024 * 1024 + 1, "a"))).toThrow(/maximum allowed size/)
  })
})

describe("validateHeaders", () => {
  it("accepts the documented headers regardless of order", () => {
    const shuffled = [...PULSE_EXPECTED_HEADERS].reverse()
    const result = validateHeaders(shuffled)
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.duplicate).toEqual([])
    expect(result.unsupported).toEqual([])
  })

  it("trims harmless surrounding whitespace on header cells", () => {
    const withWhitespace = PULSE_EXPECTED_HEADERS.map((header) => ` ${header} `)
    expect(validateHeaders(withWhitespace).ok).toBe(true)
  })

  it("detects a missing required header", () => {
    const missingOne = PULSE_EXPECTED_HEADERS.filter((header) => header !== "Quantity")
    const result = validateHeaders(missingOne)
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(["Quantity"])
  })

  it("detects a duplicate header", () => {
    const result = validateHeaders([...PULSE_EXPECTED_HEADERS, "Quantity"])
    expect(result.ok).toBe(false)
    expect(result.duplicate).toEqual(["Quantity"])
  })

  it("detects an unsupported additional header and rejects unrelated formats", () => {
    const result = validateHeaders(["Product Name", "Set", "Some Unrelated Column"])
    expect(result.ok).toBe(false)
    expect(result.unsupported).toContain("Some Unrelated Column")
    expect(result.missing.length).toBeGreaterThan(0)
  })

  it("tolerates a present optional header (e.g. Condition) without flagging it as unsupported", () => {
    const result = validateHeaders([...PULSE_EXPECTED_HEADERS, ...PULSE_OPTIONAL_HEADERS])
    expect(result.ok).toBe(true)
    expect(result.unsupported).toEqual([])
  })

  it("does not require an optional header to be present", () => {
    const result = validateHeaders([...PULSE_EXPECTED_HEADERS])
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })
})
