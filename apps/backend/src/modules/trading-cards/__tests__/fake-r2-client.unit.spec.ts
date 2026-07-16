import { FakeR2ImageStorageClient } from "../__fixtures__/fake-r2-client"

/**
 * Proves the shared module-test fake's `headObject` boundary matches the
 * real `R2ImageStorageClient`: a rejected key never reaches the in-memory
 * object map or gets recorded in `headCalls`, mirroring "never dispatches to
 * the SDK" for the real client.
 */
describe("FakeR2ImageStorageClient headObject boundary", () => {
  it("accepts a valid staging descendant key", async () => {
    const client = new FakeR2ImageStorageClient()
    const key = "staging/card-images/variant/image/uuid.jpg"
    client.seedObject(key, Buffer.from("x"))
    await expect(client.headObject(key)).resolves.toEqual(
      expect.objectContaining({ size: 1 })
    )
    expect(client.headCalls).toEqual([key])
  })

  it("accepts a valid final descendant key", async () => {
    const client = new FakeR2ImageStorageClient()
    const key = "card-images/variant/image/uuid.jpg"
    client.seedObject(key, Buffer.from("x"))
    await expect(client.headObject(key)).resolves.toEqual(
      expect.objectContaining({ size: 1 })
    )
    expect(client.headCalls).toEqual([key])
  })

  it("rejects an unrelated key without touching the object map or recording a call", async () => {
    const client = new FakeR2ImageStorageClient()
    const key = "not-managed/variant/image/uuid.jpg"
    client.seedObject(key, Buffer.from("x"))
    await expect(client.headObject(key)).rejects.toThrow(/managed R2 prefix/)
    expect(client.headCalls).toEqual([])
  })

  it("rejects an empty key without recording a call", async () => {
    const client = new FakeR2ImageStorageClient()
    await expect(client.headObject("")).rejects.toThrow(/managed R2 prefix/)
    expect(client.headCalls).toEqual([])
  })

  it("rejects the exact managed prefix without recording a call", async () => {
    const client = new FakeR2ImageStorageClient()
    await expect(client.headObject("card-images/")).rejects.toThrow(/managed R2 prefix/)
    await expect(client.headObject("staging/card-images/")).rejects.toThrow(/managed R2 prefix/)
    expect(client.headCalls).toEqual([])
  })
})
