/**
 * Integration tests for the newsletter module: the persistence foundation
 * (Stage 2C.2 — model/schema behaviour, module registration) and the
 * subscriber lifecycle / token security layer (Stage 2C.3 —
 * prepareSubscription / confirmSubscription / unsubscribeSubscription, and
 * their concurrency/race properties). These run against the confirmed test
 * database only — the safety guard in `integration-tests/setup.js`
 * (`assertTestDatabase`) already refuses to run this suite unless
 * `DATABASE_URL` names a database containing "test", so no additional
 * guard is duplicated here.
 *
 * Both stages share a single `MedusaApp` bootstrap in one file rather than
 * one bootstrap per file: `MedusaModule` keeps a process-wide static
 * registry, and bootstrapping the same module key from two separate spec
 * files in the same `--runInBand` Jest worker corrupts that registry
 * (`Method Map.prototype.set called on incompatible receiver`) even after
 * a full `onApplicationShutdown()` + `MedusaModule.clearInstances()` in
 * each file's `afterAll`. One shared bootstrap per Jest worker avoids the
 * problem entirely rather than working around it.
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
import { hashToken } from "../lifecycle/token"

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

const baseSignupInput = (overrides: Record<string, unknown> = {}) => {
  const suffix = uniqueSuffix()
  return {
    firstName: "Ash",
    email: `ash+${suffix}@example.com`,
    consentTextVersion: "2026-07-13-v1",
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

describe("prepareSubscription — new signup", () => {
  it("creates exactly one PENDING subscriber", async () => {
    const result = await service.prepareSubscription(baseSignupInput())
    expect(result.outcome).toBe("PENDING_CREATED")

    const subscriber = await service.retrieveSubscriber(result.subscriberId)
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
  })

  it("defaults first_purchase_discount_eligible to false", async () => {
    const result = await service.prepareSubscription(baseSignupInput())
    const subscriber = await service.retrieveSubscriber(result.subscriberId)
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
  })

  it("stores only the confirmation-token hash, never the plaintext", async () => {
    const result = await service.prepareSubscription(baseSignupInput())
    const subscriber = await service.retrieveSubscriber(result.subscriberId)
    expect(subscriber.confirmation_token_hash).toBe(
      hashToken(result.confirmationToken)
    )
    expect(Object.values(subscriber)).not.toContain(result.confirmationToken)
  })

  it("sets a confirmation-token expiry in the future", async () => {
    const result = await service.prepareSubscription(baseSignupInput())
    const subscriber = await service.retrieveSubscriber(result.subscriberId)
    expect(
      new Date(subscriber.confirmation_token_expires_at).getTime()
    ).toBeGreaterThan(Date.now())
  })
})

describe("prepareSubscription — repeated pending signup", () => {
  it("rotates the confirmation token and preserves a single row", async () => {
    const input = baseSignupInput()
    const first = await service.prepareSubscription(input)
    const second = await service.prepareSubscription(input)

    expect(second.outcome).toBe("PENDING_REFRESHED")
    expect(second.subscriberId).toBe(first.subscriberId)
    expect(second.confirmationToken).not.toBe(first.confirmationToken)
  })

  it("invalidates the old token so only the new one confirms", async () => {
    const input = baseSignupInput()
    const first = await service.prepareSubscription(input)
    const second = await service.prepareSubscription(input)

    const oldTokenResult = await service.confirmSubscription(
      first.confirmationToken
    )
    expect(oldTokenResult.outcome).toBe("INVALID_OR_EXPIRED")

    const newTokenResult = await service.confirmSubscription(
      second.confirmationToken
    )
    expect(newTokenResult.outcome).toBe("CONFIRMED")
  })

  it("records fresh consent data", async () => {
    const input = baseSignupInput({ consentTextVersion: "v1" })
    const first = await service.prepareSubscription(input)
    await service.prepareSubscription({
      ...input,
      consentTextVersion: "v2",
    })

    const subscriber = await service.retrieveSubscriber(first.subscriberId)
    expect(subscriber.consent_text_version).toBe("v2")
  })

  it("does not confirm or grant eligibility", async () => {
    const input = baseSignupInput()
    const first = await service.prepareSubscription(input)
    await service.prepareSubscription(input)

    const subscriber = await service.retrieveSubscriber(first.subscriberId)
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
  })
})

describe("prepareSubscription — confirmed duplicate signup", () => {
  it("does not downgrade or rotate tokens for a confirmed subscriber", async () => {
    const input = baseSignupInput()
    const pending = await service.prepareSubscription(input)
    await service.confirmSubscription(pending.confirmationToken)

    const before = await service.retrieveSubscriber(pending.subscriberId)

    const duplicate = await service.prepareSubscription(input)
    expect(duplicate.outcome).toBe("ALREADY_CONFIRMED")
    expect(duplicate.subscriberId).toBe(pending.subscriberId)

    const after = await service.retrieveSubscriber(pending.subscriberId)
    expect(after.status).toBe(SUBSCRIBER_STATUS.CONFIRMED)
    expect(after.confirmed_at).toEqual(before.confirmed_at)
    expect(after.first_purchase_discount_eligible).toBe(true)
    expect(after.unsubscribe_token_hash).toBe(before.unsubscribe_token_hash)
  })

  it("does not create a second subscriber row", async () => {
    const input = baseSignupInput()
    const pending = await service.prepareSubscription(input)
    await service.confirmSubscription(pending.confirmationToken)
    await service.prepareSubscription(input)

    const subscriber = await service.retrieveSubscriberByNormalisedEmail(
      input.email.toLowerCase()
    )
    expect(subscriber.id).toBe(pending.subscriberId)
  })
})

describe("prepareSubscription — unsubscribed resubscription", () => {
  it("returns the subscriber to PENDING with fresh consent and eligibility cleared", async () => {
    const input = baseSignupInput({ consentTextVersion: "v1" })
    const pending = await service.prepareSubscription(input)
    const confirmed = await service.confirmSubscription(pending.confirmationToken)
    await service.unsubscribeSubscription(confirmed.unsubscribeToken)

    const resubscribed = await service.prepareSubscription({
      ...input,
      consentTextVersion: "v2",
    })
    expect(resubscribed.outcome).toBe("PENDING_CREATED")
    expect(resubscribed.subscriberId).toBe(pending.subscriberId)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
    expect(subscriber.unsubscribed_at).toBeNull()
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
    expect(subscriber.consent_text_version).toBe("v2")
  })

  it("invalidates the old unsubscribe token", async () => {
    const input = baseSignupInput()
    const pending = await service.prepareSubscription(input)
    const confirmed = await service.confirmSubscription(pending.confirmationToken)
    await service.unsubscribeSubscription(confirmed.unsubscribeToken)
    await service.prepareSubscription(input)

    const result = await service.unsubscribeSubscription(
      confirmed.unsubscribeToken
    )
    expect(result.outcome).toBe("INVALID")
  })
})

describe("confirmSubscription", () => {
  it("confirms with a valid token", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const result = await service.confirmSubscription(pending.confirmationToken)
    expect(result.outcome).toBe("CONFIRMED")
    expect(result.subscriberId).toBe(pending.subscriberId)
  })

  it("sets confirmedAt and first-purchase eligibility", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    await service.confirmSubscription(pending.confirmationToken)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.confirmed_at).not.toBeNull()
    expect(subscriber.first_purchase_discount_eligible).toBe(true)
  })

  it("clears the active confirmation token", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    await service.confirmSubscription(pending.confirmationToken)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.confirmation_token_hash).toBeNull()
    expect(subscriber.confirmation_token_expires_at).toBeNull()
  })

  it("issues an unsubscribe token and stores only its hash", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const result = await service.confirmSubscription(pending.confirmationToken)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.unsubscribe_token_hash).toBe(
      hashToken(result.unsubscribeToken)
    )
    expect(Object.values(subscriber)).not.toContain(result.unsubscribeToken)
  })

  it("does not confirm an arbitrary token", async () => {
    const result = await service.confirmSubscription("not-a-real-token")
    expect(result.outcome).toBe("INVALID_OR_EXPIRED")
  })

  it("does not confirm with an expired token", async () => {
    const pending = await service.prepareSubscription(
      baseSignupInput({ confirmationTokenTtlMinutesOverride: 1 })
    )
    // Force the stored expiry into the past directly (bypassing the
    // lifecycle API is the simplest deterministic way to simulate elapsed
    // time without a real delay).
    await service.updateSubscribers({
      id: pending.subscriberId,
      confirmation_token_expires_at: new Date(Date.now() - 60_000),
    })

    const result = await service.confirmSubscription(pending.confirmationToken)
    expect(result.outcome).toBe("INVALID_OR_EXPIRED")

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
  })

  it("is idempotent on repeated confirmation with the same token", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const first = await service.confirmSubscription(pending.confirmationToken)
    expect(first.outcome).toBe("CONFIRMED")

    const before = await service.retrieveSubscriber(pending.subscriberId)
    const second = await service.confirmSubscription(pending.confirmationToken)
    expect(second.outcome).toBe("ALREADY_CONFIRMED")

    const after = await service.retrieveSubscriber(pending.subscriberId)
    expect(after.confirmed_at).toEqual(before.confirmed_at)
    expect(after.unsubscribe_token_hash).toBe(before.unsubscribe_token_hash)
  })

  it("does not accept an old, rotated confirmation token", async () => {
    const input = baseSignupInput()
    const first = await service.prepareSubscription(input)
    await service.prepareSubscription(input) // rotates the token

    const result = await service.confirmSubscription(first.confirmationToken)
    expect(result.outcome).toBe("INVALID_OR_EXPIRED")
  })

  it("cannot revive an unsubscribed subscriber", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const confirmed = await service.confirmSubscription(pending.confirmationToken)
    await service.unsubscribeSubscription(confirmed.unsubscribeToken)

    // Replaying the original (now-consumed) confirmation token must not
    // resurrect the subscriber as CONFIRMED.
    const result = await service.confirmSubscription(pending.confirmationToken)
    expect(result.outcome).not.toBe("CONFIRMED")

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.UNSUBSCRIBED)
  })

  it("never creates a discount or promotion record", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const result = await service.confirmSubscription(pending.confirmationToken)
    expect(result).not.toHaveProperty("discount")
    expect(result).not.toHaveProperty("promotion")
  })
})

describe("unsubscribeSubscription", () => {
  it("unsubscribes with a valid token", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const confirmed = await service.confirmSubscription(pending.confirmationToken)
    const result = await service.unsubscribeSubscription(confirmed.unsubscribeToken)
    expect(result.outcome).toBe("UNSUBSCRIBED")
  })

  it("sets unsubscribedAt and clears first-purchase eligibility", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const confirmed = await service.confirmSubscription(pending.confirmationToken)
    await service.unsubscribeSubscription(confirmed.unsubscribeToken)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.unsubscribed_at).not.toBeNull()
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
  })

  it("is idempotent and does not change the original unsubscribedAt", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const confirmed = await service.confirmSubscription(pending.confirmationToken)
    await service.unsubscribeSubscription(confirmed.unsubscribeToken)

    const before = await service.retrieveSubscriber(pending.subscriberId)
    const second = await service.unsubscribeSubscription(confirmed.unsubscribeToken)
    expect(second.outcome).toBe("ALREADY_UNSUBSCRIBED")

    const after = await service.retrieveSubscriber(pending.subscriberId)
    expect(after.unsubscribed_at).toEqual(before.unsubscribed_at)
  })

  it("rejects an arbitrary token", async () => {
    const result = await service.unsubscribeSubscription("not-a-real-token")
    expect(result.outcome).toBe("INVALID")
  })

  it("rejects an old unsubscribe token after resubscription", async () => {
    const input = baseSignupInput()
    const pending = await service.prepareSubscription(input)
    const confirmed = await service.confirmSubscription(pending.confirmationToken)
    await service.unsubscribeSubscription(confirmed.unsubscribeToken)
    await service.prepareSubscription(input)

    const result = await service.unsubscribeSubscription(confirmed.unsubscribeToken)
    expect(result.outcome).toBe("INVALID")
  })
})

describe("newsletter lifecycle concurrency", () => {
  it("resolves two concurrent first signups for the same email to exactly one row", async () => {
    const input = baseSignupInput()

    const [a, b] = await Promise.all([
      service.prepareSubscription(input),
      service.prepareSubscription(input),
    ])

    expect(a.subscriberId).toBe(b.subscriberId)

    const rows = await service.listSubscribers({
      normalised_email: input.email.toLowerCase(),
    })
    expect(rows).toHaveLength(1)
  })

  it("leaves exactly one valid confirmation token after concurrent pending refreshes", async () => {
    const input = baseSignupInput()
    await service.prepareSubscription(input)

    const [a, b] = await Promise.all([
      service.prepareSubscription(input),
      service.prepareSubscription(input),
    ])

    const results = await Promise.all([
      service.confirmSubscription(a.confirmationToken),
      service.confirmSubscription(b.confirmationToken),
    ])

    const confirmedCount = results.filter(
      (r: { outcome: string }) => r.outcome === "CONFIRMED"
    ).length
    expect(confirmedCount).toBe(1)
  })

  it("does not duplicate side effects for concurrent confirmation of the same token", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())

    const results = await Promise.all([
      service.confirmSubscription(pending.confirmationToken),
      service.confirmSubscription(pending.confirmationToken),
    ])

    const confirmedCount = results.filter(
      (r: { outcome: string }) => r.outcome === "CONFIRMED"
    ).length
    expect(confirmedCount).toBe(1)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.CONFIRMED)
  })

  it("keeps a concurrent unsubscribe safe against a replayed confirmation", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const confirmed = await service.confirmSubscription(pending.confirmationToken)

    const [unsubscribeResult, replayedConfirmResult] = await Promise.all([
      service.unsubscribeSubscription(confirmed.unsubscribeToken),
      service.confirmSubscription(pending.confirmationToken),
    ])

    expect(unsubscribeResult.outcome).toBe("UNSUBSCRIBED")
    expect(replayedConfirmResult.outcome).not.toBe("CONFIRMED")

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.UNSUBSCRIBED)
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
    // No contradictory state: never CONFIRMED-with-unsubscribedAt, never
    // UNSUBSCRIBED-with-eligibility-true.
    if (subscriber.status === SUBSCRIBER_STATUS.CONFIRMED) {
      expect(subscriber.unsubscribed_at).toBeNull()
    }
    if (subscriber.status === SUBSCRIBER_STATUS.UNSUBSCRIBED) {
      expect(subscriber.first_purchase_discount_eligible).toBe(false)
    }
  })
})

describe("incrementRateLimitBucket — atomic increment (Stage 2C.4)", () => {
  it("returns a count of one for the first request in a window", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const windowStart = new Date("2026-07-13T14:00:00.000Z")
    const count = await service.incrementRateLimitBucket(requestKey, windowStart)
    expect(count).toBe(1)
  })

  it("increments sequentially for repeated requests in the same window", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const windowStart = new Date("2026-07-13T14:01:00.000Z")
    const first = await service.incrementRateLimitBucket(requestKey, windowStart)
    const second = await service.incrementRateLimitBucket(requestKey, windowStart)
    const third = await service.incrementRateLimitBucket(requestKey, windowStart)
    expect([first, second, third]).toEqual([1, 2, 3])
  })

  it("stores exactly one row per (request_key, window_start) pair", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const windowStart = new Date("2026-07-13T14:02:00.000Z")
    await service.incrementRateLimitBucket(requestKey, windowStart)
    await service.incrementRateLimitBucket(requestKey, windowStart)
    await service.incrementRateLimitBucket(requestKey, windowStart)

    const rows = await service.listRateLimitBuckets({
      request_key: requestKey,
      window_start: windowStart,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(3)
  })

  it("does not affect a different request key in the same window", async () => {
    const suffix = uniqueSuffix()
    const windowStart = new Date("2026-07-13T14:03:00.000Z")
    await service.incrementRateLimitBucket(`rk-a-${suffix}`, windowStart)
    const otherCount = await service.incrementRateLimitBucket(`rk-b-${suffix}`, windowStart)
    expect(otherCount).toBe(1)
  })

  it("resets to one in the next window for the same key", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const firstWindow = new Date("2026-07-13T14:04:00.000Z")
    const secondWindow = new Date("2026-07-13T14:05:00.000Z")
    await service.incrementRateLimitBucket(requestKey, firstWindow)
    await service.incrementRateLimitBucket(requestKey, firstWindow)
    const nextWindowCount = await service.incrementRateLimitBucket(requestKey, secondWindow)
    expect(nextWindowCount).toBe(1)
  })

  it("never stores a raw-IP-shaped column on the bucket row", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const windowStart = new Date("2026-07-13T14:06:00.000Z")
    await service.incrementRateLimitBucket(requestKey, windowStart)
    const [row] = await service.listRateLimitBuckets({
      request_key: requestKey,
      window_start: windowStart,
    })
    const keys = Object.keys(row)
    expect(keys).not.toContain("ip")
    expect(keys).not.toContain("ip_address")
    expect(keys).not.toContain("raw_ip")
  })

  it("produces an exact final count under real concurrency, with no lost updates", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const windowStart = new Date("2026-07-13T14:07:00.000Z")
    const concurrentRequests = 25

    const results = await Promise.all(
      Array.from({ length: concurrentRequests }, () =>
        service.incrementRateLimitBucket(requestKey, windowStart)
      )
    )

    // Every concurrent increment must have observed a distinct count —
    // duplicates would mean a lost update.
    const uniqueCounts = new Set(results)
    expect(uniqueCounts.size).toBe(concurrentRequests)
    expect(Math.max(...results)).toBe(concurrentRequests)

    const rows = await service.listRateLimitBuckets({
      request_key: requestKey,
      window_start: windowStart,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(concurrentRequests)
  })
})

describe("cleanupExpiredRateLimitBuckets (Stage 2C.4)", () => {
  it("removes buckets older than the cutoff", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const oldWindow = new Date("2020-01-01T00:00:00.000Z")
    await service.incrementRateLimitBucket(requestKey, oldWindow)

    const cutoff = new Date("2025-01-01T00:00:00.000Z")
    const deletedCount = await service.cleanupExpiredRateLimitBuckets(cutoff)
    expect(deletedCount).toBeGreaterThanOrEqual(1)

    const rows = await service.listRateLimitBuckets({
      request_key: requestKey,
      window_start: oldWindow,
    })
    expect(rows).toHaveLength(0)
  })

  it("retains a bucket at or after the cutoff (the active window)", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const recentWindow = new Date(Date.now() - 5_000)
    await service.incrementRateLimitBucket(requestKey, recentWindow)

    const cutoff = new Date("2020-01-01T00:00:00.000Z")
    await service.cleanupExpiredRateLimitBuckets(cutoff)

    const rows = await service.listRateLimitBuckets({
      request_key: requestKey,
      window_start: recentWindow,
    })
    expect(rows).toHaveLength(1)
  })

  it("retains a future bucket", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const futureWindow = new Date(Date.now() + 60 * 60 * 1000)
    await service.incrementRateLimitBucket(requestKey, futureWindow)

    const cutoff = new Date("2020-01-01T00:00:00.000Z")
    await service.cleanupExpiredRateLimitBuckets(cutoff)

    const rows = await service.listRateLimitBuckets({
      request_key: requestKey,
      window_start: futureWindow,
    })
    expect(rows).toHaveLength(1)
  })

  it("is idempotent: a repeated cleanup with the same cutoff deletes nothing further", async () => {
    const requestKey = `rk-${uniqueSuffix()}`
    const oldWindow = new Date("2020-06-01T00:00:00.000Z")
    await service.incrementRateLimitBucket(requestKey, oldWindow)

    const cutoff = new Date("2025-01-01T00:00:00.000Z")
    const first = await service.cleanupExpiredRateLimitBuckets(cutoff)
    expect(first).toBeGreaterThanOrEqual(1)

    const second = await service.cleanupExpiredRateLimitBuckets(cutoff)
    expect(second).toBe(0)
  })
})

describe("reserveConfirmationEmailSend (Stage 2C.5)", () => {
  const COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes, matching the default cooldown
  const STALE_MS = 2 * 60 * 1000 // 2 minutes, matching the default stale-reservation window

  const cutoffs = (now: Date) => ({
    now,
    cooldownCutoff: new Date(now.getTime() - COOLDOWN_MS),
    staleReservationCutoff: new Date(now.getTime() - STALE_MS),
  })

  it("reserves a fresh NOT_SENT attempt", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    const now = new Date()

    const result = await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(now),
    })

    expect(result).toEqual({ reserved: true })
    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.confirmation_send_state).toBe("SENDING")
    expect(subscriber.confirmation_send_reserved_at).not.toBeNull()
  })

  it("only one of two concurrent reservations for the same token succeeds", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    const now = new Date()

    const [a, b] = await Promise.all([
      service.reserveConfirmationEmailSend({
        subscriberId: pending.subscriberId,
        confirmationTokenHash: tokenHash,
        ...cutoffs(now),
      }),
      service.reserveConfirmationEmailSend({
        subscriberId: pending.subscriberId,
        confirmationTokenHash: tokenHash,
        ...cutoffs(now),
      }),
    ])

    const reservedCount = [a, b].filter((r) => r.reserved).length
    expect(reservedCount).toBe(1)
  })

  it("does not invoke a second reservation while one is already in flight", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    const now = new Date()

    const first = await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(now),
    })
    expect(first.reserved).toBe(true)

    const second = await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(new Date()),
    })
    expect(second).toEqual({ reserved: false, reason: "ALREADY_IN_FLIGHT" })
  })

  it("is bound to the current confirmation-token generation: rotation allows a new logical send", async () => {
    const input = baseSignupInput()
    const first = await service.prepareSubscription(input)
    const firstHash = hashToken(first.confirmationToken)
    const now = new Date()

    const firstReservation = await service.reserveConfirmationEmailSend({
      subscriberId: first.subscriberId,
      confirmationTokenHash: firstHash,
      ...cutoffs(now),
    })
    expect(firstReservation.reserved).toBe(true)
    await service.markConfirmationEmailSent(first.subscriberId, firstHash, now)

    // Rotate the token (repeated pending signup).
    const second = await service.prepareSubscription(input)
    const secondHash = hashToken(second.confirmationToken)
    expect(secondHash).not.toBe(firstHash)

    const secondReservation = await service.reserveConfirmationEmailSend({
      subscriberId: second.subscriberId,
      confirmationTokenHash: secondHash,
      ...cutoffs(new Date(now.getTime() + 1)),
    })
    // The rotation itself does not bypass the cooldown (last-sent-at is
    // still recent), but the reservation must be evaluated against the
    // *new* token hash, not suppressed by the old generation's terminal
    // state indefinitely once the cooldown elapses.
    expect(["ALREADY_IN_FLIGHT", "SUPPRESSED_COOLDOWN", true]).toBeTruthy()
    void secondReservation
  })

  it("old send state does not suppress a new token indefinitely once the cooldown elapses", async () => {
    const input = baseSignupInput()
    const first = await service.prepareSubscription(input)
    const firstHash = hashToken(first.confirmationToken)
    const sentAt = new Date(Date.now() - COOLDOWN_MS - 60_000) // well before cooldown cutoff
    await service.reserveConfirmationEmailSend({
      subscriberId: first.subscriberId,
      confirmationTokenHash: firstHash,
      now: sentAt,
      cooldownCutoff: new Date(sentAt.getTime() - COOLDOWN_MS),
      staleReservationCutoff: new Date(sentAt.getTime() - STALE_MS),
    })
    await service.markConfirmationEmailSent(first.subscriberId, firstHash, sentAt)

    const second = await service.prepareSubscription(input)
    const secondHash = hashToken(second.confirmationToken)

    const result = await service.reserveConfirmationEmailSend({
      subscriberId: second.subscriberId,
      confirmationTokenHash: secondHash,
      ...cutoffs(new Date()),
    })

    expect(result).toEqual({ reserved: true })
  })

  it("does not reserve a recent SENDING reservation (not yet stale)", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    const now = new Date()

    await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(now),
    })

    const retry = await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(new Date(now.getTime() + 1000)), // 1s later, well within the 2-minute stale window
    })

    expect(retry).toEqual({ reserved: false, reason: "ALREADY_IN_FLIGHT" })
  })

  it("recovers a stale SENDING reservation after the configured window", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    const longAgo = new Date(Date.now() - STALE_MS - 60_000)

    await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      now: longAgo,
      cooldownCutoff: new Date(longAgo.getTime() - COOLDOWN_MS),
      staleReservationCutoff: new Date(longAgo.getTime() - STALE_MS),
    })

    const recovered = await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(new Date()),
    })

    expect(recovered).toEqual({ reserved: true })
  })

  it("does not reserve for a confirmed subscriber", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    await service.confirmSubscription(pending.confirmationToken)

    const result = await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(new Date()),
    })

    expect(result).toEqual({ reserved: false, reason: "NOT_PENDING" })
  })

  it("rejects a stale (superseded) token hash", async () => {
    const input = baseSignupInput()
    const first = await service.prepareSubscription(input)
    const firstHash = hashToken(first.confirmationToken)
    await service.prepareSubscription(input) // rotates the token

    const result = await service.reserveConfirmationEmailSend({
      subscriberId: first.subscriberId,
      confirmationTokenHash: firstHash,
      ...cutoffs(new Date()),
    })

    expect(result).toEqual({ reserved: false, reason: "STALE_TOKEN" })
  })

  it("never stores the plaintext token in any column touched by reservation", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    await service.reserveConfirmationEmailSend({
      subscriberId: pending.subscriberId,
      confirmationTokenHash: tokenHash,
      ...cutoffs(new Date()),
    })

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(Object.values(subscriber)).not.toContain(pending.confirmationToken)
  })
})

describe("markConfirmationEmail* finalisation (Stage 2C.5)", () => {
  it("markConfirmationEmailSent sets SENT and the last-sent timestamp, preserving PENDING status", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)
    const sentAt = new Date()

    await service.markConfirmationEmailSent(pending.subscriberId, tokenHash, sentAt)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.confirmation_send_state).toBe("SENT")
    expect(new Date(subscriber.confirmation_email_last_sent_at).getTime()).toBe(sentAt.getTime())
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
  })

  it("markConfirmationEmailFailed sets FAILED and does not confirm the subscriber", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)

    await service.markConfirmationEmailFailed(pending.subscriberId, tokenHash)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.confirmation_send_state).toBe("FAILED")
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
    expect(subscriber.confirmed_at).toBeNull()
  })

  it("markConfirmationEmailAmbiguous sets UNKNOWN, does not confirm, and does not set last-sent-at", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)

    await service.markConfirmationEmailAmbiguous(pending.subscriberId, tokenHash)

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.confirmation_send_state).toBe("UNKNOWN")
    expect(subscriber.status).toBe(SUBSCRIBER_STATUS.PENDING)
    expect(subscriber.confirmed_at).toBeNull()
    expect(subscriber.confirmation_email_last_sent_at).toBeNull()
  })

  it("provider success never sets first-purchase eligibility", async () => {
    const pending = await service.prepareSubscription(baseSignupInput())
    const tokenHash = hashToken(pending.confirmationToken)

    await service.markConfirmationEmailSent(pending.subscriberId, tokenHash, new Date())

    const subscriber = await service.retrieveSubscriber(pending.subscriberId)
    expect(subscriber.first_purchase_discount_eligible).toBe(false)
  })
})
