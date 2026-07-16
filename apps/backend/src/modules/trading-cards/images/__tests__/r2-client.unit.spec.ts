import {
  expiresAtFromNow, readBoundedStream, readFetchedObjectFromResponse,
  type DestroyableByteStream, type RawGetObjectResponse,
} from "../r2-client"

const MAX_BYTES = 10

/**
 * A fake stream shaped exactly like `DestroyableByteStream`: an async
 * iterable of `Uint8Array` chunks plus an optional `destroy()`. No real
 * network, file, or R2 call is ever involved in any test in this file —
 * every scenario below is driven entirely by in-memory fixtures.
 */
function fakeStream(chunks: Buffer[], options: { failAfter?: number } = {}): DestroyableByteStream & { destroyCalls: number } {
  const state = { destroyCalls: 0 }
  return {
    get destroyCalls() {
      return state.destroyCalls
    },
    destroy() {
      state.destroyCalls += 1
    },
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < chunks.length; index++) {
        if (options.failAfter !== undefined && index === options.failAfter) {
          throw new Error("simulated stream read failure")
        }
        yield chunks[index]
      }
    },
  }
}

describe("readBoundedStream", () => {
  it("succeeds when the stream totals exactly the limit", async () => {
    const stream = fakeStream([Buffer.alloc(MAX_BYTES, 1)])
    const result = await readBoundedStream(stream, MAX_BYTES)
    expect(result.length).toBe(MAX_BYTES)
    expect(stream.destroyCalls).toBe(0)
  })

  it("rejects and destroys the stream one byte over the limit", async () => {
    const stream = fakeStream([Buffer.alloc(MAX_BYTES + 1, 1)])
    await expect(readBoundedStream(stream, MAX_BYTES)).rejects.toThrow(/exceeds the maximum allowed size/)
    expect(stream.destroyCalls).toBe(1)
  })

  it("rejects as soon as the running total crosses the limit across multiple chunks", async () => {
    const stream = fakeStream([Buffer.alloc(6, 1), Buffer.alloc(6, 2)])
    await expect(readBoundedStream(stream, MAX_BYTES)).rejects.toThrow(/exceeds the maximum allowed size/)
    expect(stream.destroyCalls).toBe(1)
  })

  it("never returns a partial buffer for an oversized stream", async () => {
    const stream = fakeStream([Buffer.alloc(MAX_BYTES + 1, 1)])
    let result: Buffer | undefined
    try {
      result = await readBoundedStream(stream, MAX_BYTES)
    } catch {
      // expected
    }
    expect(result).toBeUndefined()
  })

  it("wraps a mid-stream read failure in a safe storage error and destroys the stream", async () => {
    const stream = fakeStream([Buffer.alloc(4, 1), Buffer.alloc(4, 2)], { failAfter: 1 })
    await expect(readBoundedStream(stream, MAX_BYTES)).rejects.toThrow(/could not be read from storage/)
    await expect(readBoundedStream(stream, MAX_BYTES)).rejects.not.toThrow(/simulated stream read failure/)
    expect(stream.destroyCalls).toBeGreaterThanOrEqual(1)
  })
})

describe("readFetchedObjectFromResponse", () => {
  function response(overrides: Partial<RawGetObjectResponse> = {}): RawGetObjectResponse {
    return { Body: fakeStream([Buffer.alloc(4, 9)]), ContentType: "image/jpeg", ...overrides }
  }

  it("rejects immediately when ContentLength already exceeds the limit, before reading any bytes", async () => {
    const stream = fakeStream([Buffer.alloc(4, 9)])
    await expect(
      readFetchedObjectFromResponse(response({ Body: stream, ContentLength: MAX_BYTES + 1 }), MAX_BYTES)
    ).rejects.toThrow(/exceeds the maximum allowed size/)
    expect(stream.destroyCalls).toBe(1)
  })

  it("still enforces the streaming limit when ContentLength is missing", async () => {
    const stream = fakeStream([Buffer.alloc(MAX_BYTES + 1, 9)])
    await expect(
      readFetchedObjectFromResponse(response({ Body: stream, ContentLength: undefined }), MAX_BYTES)
    ).rejects.toThrow(/exceeds the maximum allowed size/)
  })

  it("succeeds and reports the content type for an object within the limit", async () => {
    const result = await readFetchedObjectFromResponse(response({ ContentLength: 4 }), MAX_BYTES)
    expect(result.byteSize).toBe(4)
    expect(result.contentType).toBe("image/jpeg")
  })

  it("rejects with a safe error when the response has no body", async () => {
    await expect(readFetchedObjectFromResponse({ ContentType: "image/jpeg" }, MAX_BYTES))
      .rejects.toThrow(/could not be read from storage/)
  })
})

describe("expiresAtFromNow", () => {
  it("adds the given number of minutes to the reference time", () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    expect(expiresAtFromNow(15, now)).toEqual(new Date("2026-01-01T00:15:00.000Z"))
  })

  it("supports fractional minutes", () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    expect(expiresAtFromNow(0.5, now)).toEqual(new Date("2026-01-01T00:00:30.000Z"))
  })

  it("defaults to the current time when no reference is given", () => {
    const before = Date.now()
    const result = expiresAtFromNow(15)
    const after = Date.now()
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000)
    expect(result.getTime()).toBeLessThanOrEqual(after + 15 * 60_000)
  })
})
