/**
 * Integration tests for the newsletter module's persistence foundation
 * (Stage 2C.2). These run against the confirmed test database only — the
 * safety guard in `integration-tests/setup.js` (`assertTestDatabase`)
 * already refuses to run this suite unless `DATABASE_URL` names a database
 * containing "test", so no additional guard is duplicated here.
 *
 * Scope: model/schema behaviour and module registration only. No token
 * generation, hashing, rate-limit increment, or subscriber lifecycle
 * orchestration is exercised — those belong to later Stage 2C tasks.
 *
 * This bootstraps the module directly via `@medusajs/framework/modules-sdk`
 * (the same primitive `@medusajs/test-utils`'s `initModules` wraps) rather
 * than importing `@medusajs/test-utils` itself: that package's `database`
 * helper unconditionally requires the `pg-god` package, which manages its
 * own create/drop-database lifecycle from separate `DB_HOST`/`DB_USERNAME`
 * env vars rather than the already-guarded `DATABASE_URL`, and is not an
 * installed dependency in this repository. Bootstrapping directly connects
 * with the same `DATABASE_URL` the test-database safety guard already
 * verified, and never creates or drops a database.
 */
import { MedusaApp } from "@medusajs/framework/modules-sdk"
import {
  ContainerRegistrationKeys,
  createPgConnection,
} from "@medusajs/framework/utils"
import { NEWSLETTER_MODULE } from "../index"
import { SUBSCRIBER_STATUS } from "../models/subscriber"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any

const uniqueSuffix = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const baseSubscriberInput = (overrides: Record<string, unknown> = {}) => {
  const suffix = uniqueSuffix()
  return {
    first_name: "Ash",
    email: `ash+${suffix}@example.com`,
    normalised_email: `ash+${suffix}@example.com`,
    consent_text_version: "2026-07-13-v1",
    consented_at: new Date(),
    source: "coming-soon",
    ...overrides,
  }
}

beforeAll(async () => {
  pgConnection = createPgConnection({
    clientUrl: process.env.DATABASE_URL as string,
  })

  medusaApp = await MedusaApp({
    modulesConfig: {
      [NEWSLETTER_MODULE]: {
        resolve: "./src/modules/newsletter",
      },
    },
    injectedDependencies: {
      [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection,
    },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[NEWSLETTER_MODULE]
}, 60000)

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

describe("newsletter module registration", () => {
  it("resolves the newsletter module service", () => {
    expect(service).toBeDefined()
    expect(typeof service.createSubscribers).toBe("function")
    expect(typeof service.createRateLimitBuckets).toBe("function")
  })

  it("creates and retrieves a subscriber", async () => {
    const created = await service.createSubscribers(baseSubscriberInput())
    expect(created.id).toBeDefined()

    const retrieved = await service.retrieveSubscriber(created.id)
    expect(retrieved.email).toBe(created.email)
  })

  it("creates and retrieves a rate-limit bucket", async () => {
    const suffix = uniqueSuffix()
    const created = await service.createRateLimitBuckets({
      request_key: `hmac-${suffix}`,
      window_start: new Date(),
    })
    expect(created.id).toBeDefined()

    const retrieved = await service.retrieveRateLimitBucket(created.id)
    expect(retrieved.request_key).toBe(`hmac-${suffix}`)
  })
})

describe("subscriber model and schema behaviour", () => {
  it("creates a subscriber with required fields and defaults to PENDING", async () => {
    const subscriber = await service.createSubscribers(baseSubscriberInput())
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
  })

  it("defaults first_purchase_discount_eligible to false", async () => {
    const subscriber = await service.createSubscribers(baseSubscriberInput())
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
  })

  it("rejects a duplicate normalised_email", async () => {
    const suffix = uniqueSuffix()
    const normalisedEmail = `dup+${suffix}@example.com`

    await service.createSubscribers(
      baseSubscriberInput({
        email: normalisedEmail,
        normalised_email: normalisedEmail,
      })
    )

    await expect(
      service.createSubscribers(
        baseSubscriberInput({
          email: normalisedEmail,
          normalised_email: normalisedEmail,
        })
      )
    ).rejects.toThrow()
  })

  it("allows null confirmation_token_hash on multiple subscribers", async () => {
    const a = await service.createSubscribers(
      baseSubscriberInput({ confirmation_token_hash: null })
    )
    const b = await service.createSubscribers(
      baseSubscriberInput({ confirmation_token_hash: null })
    )
    expect(a.confirmation_token_hash).toBeNull()
    expect(b.confirmation_token_hash).toBeNull()
  })

  it("rejects a duplicate non-null confirmation_token_hash", async () => {
    const suffix = uniqueSuffix()
    const tokenHash = `token-hash-${suffix}`

    await service.createSubscribers(
      baseSubscriberInput({ confirmation_token_hash: tokenHash })
    )

    await expect(
      service.createSubscribers(
        baseSubscriberInput({ confirmation_token_hash: tokenHash })
      )
    ).rejects.toThrow()
  })

  it("allows null unsubscribe_token_hash on multiple subscribers", async () => {
    const a = await service.createSubscribers(
      baseSubscriberInput({ unsubscribe_token_hash: null })
    )
    const b = await service.createSubscribers(
      baseSubscriberInput({ unsubscribe_token_hash: null })
    )
    expect(a.unsubscribe_token_hash).toBeNull()
    expect(b.unsubscribe_token_hash).toBeNull()
  })

  it("rejects a duplicate non-null unsubscribe_token_hash", async () => {
    const suffix = uniqueSuffix()
    const tokenHash = `unsub-hash-${suffix}`

    await service.createSubscribers(
      baseSubscriberInput({ unsubscribe_token_hash: tokenHash })
    )

    await expect(
      service.createSubscribers(
        baseSubscriberInput({ unsubscribe_token_hash: tokenHash })
      )
    ).rejects.toThrow()
  })
})

describe("rate-limit bucket model and schema behaviour", () => {
  it("rejects a duplicate (request_key, window_start) pair", async () => {
    const suffix = uniqueSuffix()
    const requestKey = `hmac-${suffix}`
    const windowStart = new Date("2026-07-13T12:00:00.000Z")

    await service.createRateLimitBuckets({
      request_key: requestKey,
      window_start: windowStart,
    })

    await expect(
      service.createRateLimitBuckets({
        request_key: requestKey,
        window_start: windowStart,
      })
    ).rejects.toThrow()
  })

  it("allows separate windows for the same request key", async () => {
    const suffix = uniqueSuffix()
    const requestKey = `hmac-${suffix}`

    const first = await service.createRateLimitBuckets({
      request_key: requestKey,
      window_start: new Date("2026-07-13T12:00:00.000Z"),
    })
    const second = await service.createRateLimitBuckets({
      request_key: requestKey,
      window_start: new Date("2026-07-13T12:01:00.000Z"),
    })

    expect(first.id).not.toBe(second.id)
  })

  it("allows separate request keys in the same window", async () => {
    const suffix = uniqueSuffix()
    const windowStart = new Date("2026-07-13T13:00:00.000Z")

    const first = await service.createRateLimitBuckets({
      request_key: `hmac-a-${suffix}`,
      window_start: windowStart,
    })
    const second = await service.createRateLimitBuckets({
      request_key: `hmac-b-${suffix}`,
      window_start: windowStart,
    })

    expect(first.id).not.toBe(second.id)
  })
})

describe("safety properties", () => {
  it("targets only the confirmed test database", () => {
    expect(process.env.DATABASE_URL).toMatch(/test/i)
  })

  it("has no plaintext confirmation-token or unsubscribe-token column", async () => {
    const subscriber = await service.createSubscribers(baseSubscriberInput())
    const keys = Object.keys(subscriber)
    expect(keys).not.toContain("confirmation_token")
    expect(keys).not.toContain("unsubscribe_token")
    expect(keys).not.toContain("plaintext_token")
  })

  it("has no raw-IP column on the rate-limit bucket", async () => {
    const suffix = uniqueSuffix()
    const bucket = await service.createRateLimitBuckets({
      request_key: `hmac-${suffix}`,
      window_start: new Date(),
    })
    const keys = Object.keys(bucket)
    expect(keys).not.toContain("ip")
    expect(keys).not.toContain("ip_address")
    expect(keys).not.toContain("raw_ip")
  })

  it("never defaults first_purchase_discount_eligible to true", async () => {
    for (let i = 0; i < 3; i++) {
      const subscriber = await service.createSubscribers(
        baseSubscriberInput()
      )
      expect(subscriber.first_purchase_discount_eligible).toBe(false)
    }
  })
})
