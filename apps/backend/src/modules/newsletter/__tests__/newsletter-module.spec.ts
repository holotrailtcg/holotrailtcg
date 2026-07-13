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
