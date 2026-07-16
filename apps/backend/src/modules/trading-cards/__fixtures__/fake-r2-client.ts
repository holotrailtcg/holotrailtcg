import { MedusaError } from "@medusajs/framework/utils"
import type {
  FetchedObject, ListObjectsPage, PresignedUpload, R2ImageStorageClient,
} from "../images/r2-client"
import { assertManagedKey, assertManagedPrefix } from "../images/managed-prefixes"

/**
 * A hand-rolled fake `R2ImageStorageClient` shared across every
 * trading-cards module-level integration spec. No real network call is ever
 * made — object bytes live entirely in an in-memory map, seeded by each
 * test via `seedObject` to simulate "the browser already PUT the file", or
 * populated directly via `putObject`/confirmation for cleanup-job tests.
 *
 * Lives under `__fixtures__/`, not `__tests__/`, because the
 * `integration:modules` Jest config's `testMatch` picks up every file under
 * `__tests__/**` as its own test suite — a non-spec support file placed
 * there fails with "Your test suite must contain at least one test."
 */
export class FakeR2ImageStorageClient implements R2ImageStorageClient {
  private objects = new Map<string, { bytes: Buffer; lastModified: Date }>()
  private presignFailure: Error | null = null
  private getFailure: Error | null = null
  private putFailure: Error | null = null
  private deleteFailure: Error | null = null
  private listFailure: Error | null = null
  /** Runs once, synchronously, at the start of the next `putObject` call — used to simulate real-world timing (e.g. the upload window expiring mid-network-call) without waiting real time. */
  private putSideEffect: (() => Promise<void> | void) | null = null
  public readonly presignCalls: Array<{ key: string; contentType: string; expiresInSeconds: number }> = []
  public readonly getCalls: string[] = []
  public readonly putCalls: Array<{ key: string; contentType: string; contentLength: number }> = []
  public readonly headCalls: string[] = []
  public readonly deleteCalls: string[] = []
  public readonly listCalls: Array<{ prefix: string; continuationToken?: string; maxKeys?: number }> = []

  /** Seeds an object with an optional `lastModified` (defaults to now) — used by orphan-reconciliation tests to simulate an object's age relative to the grace period. */
  seedObject(key: string, bytes: Buffer, lastModified: Date = new Date()) {
    this.objects.set(key, { bytes, lastModified })
  }

  /** The next `createPresignedPutUrl` call throws `error` instead of succeeding; consumed once. */
  failNextPresignWith(error: Error) {
    this.presignFailure = error
  }

  /** The next `getObject` call throws `error` instead of succeeding; consumed once. */
  failNextGetWith(error: Error) {
    this.getFailure = error
  }

  /** The next `putObject` call throws `error` instead of succeeding; consumed once. */
  failNextPutWith(error: Error) {
    this.putFailure = error
  }

  /** The next `deleteObject` call throws `error` instead of succeeding; consumed once. */
  failNextDeleteWith(error: Error) {
    this.deleteFailure = error
  }

  /** The next `listObjects` call throws `error` instead of succeeding; consumed once. */
  failNextListWith(error: Error) {
    this.listFailure = error
  }

  /** Runs `effect` once at the start of the next `putObject` call, before it succeeds or fails. */
  onNextPut(effect: () => Promise<void> | void) {
    this.putSideEffect = effect
  }

  /** True iff `key` is still present in the in-memory store — used by tests to assert a deletion did or did not happen. */
  hasObject(key: string): boolean {
    return this.objects.has(key)
  }

  async createPresignedPutUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedUpload> {
    this.presignCalls.push(input)
    if (this.presignFailure) {
      const error = this.presignFailure
      this.presignFailure = null
      throw error
    }
    return {
      uploadUrl: `https://fake-r2.invalid/${input.key}`,
      requiredHeaders: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    }
  }

  async getObject(key: string): Promise<FetchedObject> {
    this.getCalls.push(key)
    if (this.getFailure) {
      const error = this.getFailure
      this.getFailure = null
      throw error
    }
    const entry = this.objects.get(key)
    if (!entry) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "fake object not found")
    }
    return { bytes: entry.bytes, byteSize: entry.bytes.length, contentType: null }
  }

  async putObject(input: { key: string; body: Buffer; contentType: string; contentLength: number }): Promise<void> {
    if (this.putSideEffect) {
      const effect = this.putSideEffect
      this.putSideEffect = null
      await effect()
    }
    this.putCalls.push({ key: input.key, contentType: input.contentType, contentLength: input.contentLength })
    if (this.putFailure) {
      const error = this.putFailure
      this.putFailure = null
      throw error
    }
    this.objects.set(input.key, { bytes: input.body, lastModified: new Date() })
  }

  async headObject(key: string): Promise<{ lastModified: Date; size: number }> {
    assertManagedKey(key)
    this.headCalls.push(key)
    const entry = this.objects.get(key)
    if (!entry) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "fake object not found")
    }
    return { lastModified: entry.lastModified, size: entry.bytes.length }
  }

  async deleteObject(key: string): Promise<void> {
    assertManagedKey(key)
    this.deleteCalls.push(key)
    if (this.deleteFailure) {
      const error = this.deleteFailure
      this.deleteFailure = null
      throw error
    }
    this.objects.delete(key)
  }

  async listObjects(input: { prefix: string; continuationToken?: string; maxKeys?: number }): Promise<ListObjectsPage> {
    assertManagedPrefix(input.prefix)
    this.listCalls.push(input)
    if (this.listFailure) {
      const error = this.listFailure
      this.listFailure = null
      throw error
    }
    // Sorted-by-key so continuationToken (the last key already returned) has
    // a stable, deterministic meaning across calls, matching real
    // ListObjectsV2 pagination semantics closely enough for reconciliation
    // tests to exercise real multi-page loops against this fake.
    const matching = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(input.prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const startIndex = input.continuationToken
      ? matching.findIndex(([key]) => key > input.continuationToken!)
      : 0
    const remaining = startIndex === -1 ? [] : matching.slice(startIndex)
    const page = input.maxKeys ? remaining.slice(0, input.maxKeys) : remaining
    const objects = page.map(([key, entry]) => ({ key, lastModified: entry.lastModified, size: entry.bytes.length }))
    const hasMore = page.length < remaining.length
    return {
      objects,
      nextContinuationToken: hasMore ? objects[objects.length - 1]?.key : undefined,
    }
  }
}
