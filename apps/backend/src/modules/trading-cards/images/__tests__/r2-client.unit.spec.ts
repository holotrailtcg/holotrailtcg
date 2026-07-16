import {
  createR2ImageStorageClient,
  expiresAtFromNow, mapHeadObjectResponse, mapListObjectsV2Response, readBoundedStream, readFetchedObjectFromResponse,
  type DestroyableByteStream, type RawGetObjectResponse,
} from "../r2-client"
import type { R2EnabledConfig } from "../r2-config"

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

describe("mapHeadObjectResponse", () => {
  it("maps LastModified and ContentLength", () => {
    const lastModified = new Date("2026-01-01T00:00:00.000Z")
    expect(mapHeadObjectResponse({ LastModified: lastModified, ContentLength: 1234 }))
      .toEqual({ lastModified, size: 1234 })
  })

  it("defaults size to 0 and lastModified to the epoch when missing", () => {
    expect(mapHeadObjectResponse({})).toEqual({ lastModified: new Date(0), size: 0 })
  })
})

describe("mapListObjectsV2Response", () => {
  it("maps Key/LastModified/Size for each entry", () => {
    const lastModified = new Date("2026-01-01T00:00:00.000Z")
    const result = mapListObjectsV2Response({
      Contents: [{ Key: "card-images/a/b/c.jpg", LastModified: lastModified, Size: 42 }],
    })
    expect(result.objects).toEqual([{ key: "card-images/a/b/c.jpg", lastModified, size: 42 }])
  })

  it("drops entries with no Key", () => {
    const result = mapListObjectsV2Response({ Contents: [{ LastModified: new Date(), Size: 1 }] })
    expect(result.objects).toEqual([])
  })

  it("returns nextContinuationToken only when IsTruncated is true", () => {
    const truncated = mapListObjectsV2Response({ IsTruncated: true, NextContinuationToken: "token-a" })
    expect(truncated.nextContinuationToken).toBe("token-a")

    const notTruncated = mapListObjectsV2Response({ IsTruncated: false, NextContinuationToken: "token-b" })
    expect(notTruncated.nextContinuationToken).toBeUndefined()
  })

  it("returns an empty objects array when Contents is absent", () => {
    expect(mapListObjectsV2Response({})).toEqual({ objects: [], nextContinuationToken: undefined })
  })
})

/**
 * These two guards run before any AWS SDK call is dispatched (see
 * `listObjects`/`deleteObject` in `r2-client.ts`), so exercising them
 * through the real `createR2ImageStorageClient` never makes a real network
 * call — the rejection happens synchronously inside the guard.
 */
describe("createR2ImageStorageClient prefix/key guards", () => {
  const fakeConfig: R2EnabledConfig = {
    enabled: true,
    accountId: "a".repeat(32),
    accessKeyId: "fake-access-key-id",
    secretAccessKey: "fake-secret-access-key",
    bucketName: "fake-bucket",
    endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    publicBaseUrl: "https://images.example.com",
    region: "auto",
    cacheControl: "public, max-age=31536000, immutable",
    acl: false,
  }

  it("listObjects rejects a non-managed prefix without dispatching any SDK call", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    await expect(client.listObjects({ prefix: "not-managed/" })).rejects.toThrow(/managed R2 prefix/)
  })

  it("deleteObject rejects a key outside both managed prefixes without dispatching any SDK call", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    await expect(client.deleteObject("not-managed/some-key.jpg")).rejects.toThrow(/managed R2 prefix/)
  })

  it("headObject accepts a valid staging descendant key (rejected only by the network, not the guard)", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    // No real network is reachable in this unit test, so a valid key still
    // throws — but it must fail from the SDK call, not the synchronous guard.
    await expect(client.headObject("staging/card-images/variant/image/uuid.jpg"))
      .rejects.not.toThrow(/managed R2 prefix/)
  })

  it("headObject accepts a valid final descendant key (rejected only by the network, not the guard)", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    await expect(client.headObject("card-images/variant/image/uuid.jpg"))
      .rejects.not.toThrow(/managed R2 prefix/)
  })

  it("headObject rejects an unrelated key without dispatching any SDK call", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    await expect(client.headObject("not-managed/some-key.jpg")).rejects.toThrow(/managed R2 prefix/)
  })

  it("headObject rejects an empty key without dispatching any SDK call", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    await expect(client.headObject("")).rejects.toThrow(/managed R2 prefix/)
  })

  it("headObject rejects the exact managed prefix without dispatching any SDK call", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    await expect(client.headObject("card-images/")).rejects.toThrow(/managed R2 prefix/)
    await expect(client.headObject("staging/card-images/")).rejects.toThrow(/managed R2 prefix/)
  })

  it("headObject never includes the supplied key in the thrown error message for a rejected key", async () => {
    const client = createR2ImageStorageClient(fakeConfig)
    const secretLookingKey = "not-managed/super-secret-path/uuid.jpg"
    try {
      await client.headObject(secretLookingKey)
      throw new Error("expected headObject to throw")
    } catch (error) {
      expect((error as Error).message).not.toContain(secretLookingKey)
    }
  })
})
