import {
  MedusaService,
  MedusaError,
  generateEntityId,
} from "@medusajs/framework/utils"
import Subscriber, { SUBSCRIBER_STATUS } from "./models/subscriber"
import RateLimitBucket from "./models/rate-limit-bucket"
import { cleanFirstName, assertConsentInput } from "./lifecycle/clean-input"
import { normaliseEmail } from "./lifecycle/email"
import { generateOpaqueToken, hashToken } from "./lifecycle/token"
import { resolveConfirmationTokenTtlMinutes } from "./lifecycle/config"
import type {
  ConfirmationEmailReservationOutcome,
  ConfirmationResult,
  PrepareSubscriptionInput,
  SignupResult,
  UnsubscribeResult,
} from "./lifecycle/types"

/**
 * Minimal structural interface over MikroORM's SqlEntityManager, scoped to
 * only the raw-SQL primitives the lifecycle methods below use. The
 * subscriber lifecycle needs single-statement, transaction-scoped
 * conditional `UPDATE`/`INSERT ... ON CONFLICT` semantics that the
 * generated `MedusaService` CRUD methods do not expose, so these methods
 * talk to the database directly via the module's own injected `manager` —
 * the same connection MikroORM itself uses for this module. This mirrors
 * the official pattern used by `@medusajs/locking-postgres`'s
 * `PostgresAdvisoryLockProvider` (`container.manager`, `manager.execute`,
 * `manager.transactional`). A narrow interface is used here instead of
 * `any` because MikroORM's full `SqlEntityManager` type isn't cleanly
 * re-exported for this raw-SQL use case; this covers only what is called.
 */
interface NewsletterTransactionManager {
  execute<T = Record<string, unknown>>(
    query: string,
    params?: unknown[]
  ): Promise<T[]>
}
interface NewsletterEntityManager extends NewsletterTransactionManager {
  transactional<T>(
    cb: (manager: NewsletterTransactionManager) => Promise<T>
  ): Promise<T>
}

/**
 * Newsletter module service. Storage-level lookups plus the subscriber
 * lifecycle (prepare/confirm/unsubscribe). Token generation/hashing, email
 * normalisation and input cleaning live in `./lifecycle/*`; rate-limit
 * increment logic, public routes, reCAPTCHA and Resend delivery are out of
 * scope for this stage (see docs/decisions/0005-newsletter-backend-design.md).
 */
class NewsletterModuleService extends MedusaService({
  Subscriber,
  RateLimitBucket,
}) {
  protected manager_: NewsletterEntityManager

  constructor(container: { manager: NewsletterEntityManager }) {
    // @ts-ignore MedusaService's generated base constructor accepts the raw DI container.
    super(...arguments)
    this.manager_ = container.manager
  }

  async retrieveSubscriberByNormalisedEmail(normalisedEmail: string) {
    const [subscriber] = await this.listSubscribers({
      normalised_email: normalisedEmail,
    })
    return subscriber ?? null
  }

  async retrieveSubscriberByConfirmationTokenHash(
    confirmationTokenHash: string
  ) {
    const [subscriber] = await this.listSubscribers({
      confirmation_token_hash: confirmationTokenHash,
    })
    return subscriber ?? null
  }

  async retrieveSubscriberByUnsubscribeTokenHash(unsubscribeTokenHash: string) {
    const [subscriber] = await this.listSubscribers({
      unsubscribe_token_hash: unsubscribeTokenHash,
    })
    return subscriber ?? null
  }

  /**
   * Prepares a pending subscription: creates a new `PENDING` subscriber,
   * rotates the confirmation token of an existing `PENDING` subscriber,
   * restarts an `UNSUBSCRIBED` subscriber as a fresh pending signup, or
   * leaves a `CONFIRMED` subscriber untouched.
   *
   * Concurrency-safe: brand-new rows rely on `INSERT ... ON CONFLICT DO
   * NOTHING` against the unique `normalised_email` index (Postgres blocks
   * the losing concurrent insert until the winner commits, then it
   * re-reads and falls through to the existing-row path); every other
   * transition locks the row with `SELECT ... FOR UPDATE` before deciding,
   * so two concurrent calls for the same email can never create two rows
   * or leave two valid confirmation tokens.
   */
  async prepareSubscription(input: PrepareSubscriptionInput): Promise<SignupResult> {
    const firstName = cleanFirstName(input.firstName)
    const { email, normalisedEmail } = normaliseEmail(input.email)
    const consent = assertConsentInput({
      consentTextVersion: input.consentTextVersion,
      consentedAt: input.consentedAt,
      source: input.source,
    })
    const ttlMinutes = resolveConfirmationTokenTtlMinutes(
      input.confirmationTokenTtlMinutesOverride
    )

    return await this.manager_.transactional(async (manager) => {
      const confirmationToken = generateOpaqueToken()
      const confirmationTokenHash = hashToken(confirmationToken)
      const confirmationTokenExpiresAt = new Date(
        Date.now() + ttlMinutes * 60_000
      )
      const newId = generateEntityId(undefined, "nlsub")

      const inserted = await manager.execute<{ id: string }>(
        `insert into newsletter_subscriber
           (id, first_name, email, normalised_email, status, consent_text_version, consented_at, source,
            confirmation_token_hash, confirmation_token_expires_at, first_purchase_discount_eligible)
         values (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, false)
         on conflict (normalised_email) where deleted_at is null do nothing
         returning id`,
        [
          newId,
          firstName,
          email,
          normalisedEmail,
          consent.consentTextVersion,
          consent.consentedAt,
          consent.source,
          confirmationTokenHash,
          confirmationTokenExpiresAt,
        ]
      )

      if (inserted.length > 0) {
        return {
          outcome: "PENDING_CREATED" as const,
          subscriberId: inserted[0].id,
          confirmationToken,
        }
      }

      const [existing] = await manager.execute<{ id: string; status: string }>(
        `select id, status from newsletter_subscriber
         where normalised_email = ? and deleted_at is null
         for update`,
        [normalisedEmail]
      )

      if (!existing) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Newsletter subscriber insert conflicted without a matching row"
        )
      }

      if (existing.status === SUBSCRIBER_STATUS.CONFIRMED) {
        return { outcome: "ALREADY_CONFIRMED" as const, subscriberId: existing.id }
      }

      if (existing.status === SUBSCRIBER_STATUS.PENDING) {
        await manager.execute(
          `update newsletter_subscriber
           set first_name = ?, email = ?, consent_text_version = ?, consented_at = ?, source = ?,
               confirmation_token_hash = ?, confirmation_token_expires_at = ?,
               confirmation_token_consumed_hash = null
           where id = ?`,
          [
            firstName,
            email,
            consent.consentTextVersion,
            consent.consentedAt,
            consent.source,
            confirmationTokenHash,
            confirmationTokenExpiresAt,
            existing.id,
          ]
        )
        return {
          outcome: "PENDING_REFRESHED" as const,
          subscriberId: existing.id,
          confirmationToken,
        }
      }

      // existing.status === UNSUBSCRIBED: treat as a fresh pending signup —
      // fresh consent, fresh token, cleared eligibility, invalidated
      // unsubscribe token.
      await manager.execute(
        `update newsletter_subscriber
         set first_name = ?, email = ?, status = 'PENDING', consent_text_version = ?, consented_at = ?, source = ?,
             confirmation_token_hash = ?, confirmation_token_expires_at = ?,
             confirmation_token_consumed_hash = null, confirmed_at = null, unsubscribed_at = null,
             first_purchase_discount_eligible = false, unsubscribe_token_hash = null
         where id = ?`,
        [
          firstName,
          email,
          consent.consentTextVersion,
          consent.consentedAt,
          consent.source,
          confirmationTokenHash,
          confirmationTokenExpiresAt,
          existing.id,
        ]
      )
      return {
        outcome: "PENDING_CREATED" as const,
        subscriberId: existing.id,
        confirmationToken,
      }
    })
  }

  /**
   * Confirms a subscriber from a plaintext confirmation token. The token is
   * hashed before every lookup; plaintext is never used to query the
   * database.
   *
   * Idempotent: a token that has already been consumed is recognised via
   * `confirmation_token_consumed_hash` (set in the same statement that
   * clears the active hash on success), so a repeated click on the same
   * link resolves to `ALREADY_CONFIRMED` rather than being indistinguishable
   * from an arbitrary invalid token — without keeping the active
   * confirmation token usable indefinitely.
   *
   * Race-safe against a concurrent unsubscribe: the success `UPDATE`'s
   * `WHERE` clause requires `status = 'PENDING' AND confirmation_token_hash
   * = ?`, so once a row is confirmed (or unsubscribed) a second confirming
   * transaction's conditional update simply matches zero rows.
   */
  async confirmSubscription(token: string): Promise<ConfirmationResult> {
    const tokenHash = hashToken(token)

    return await this.manager_.transactional(async (manager) => {
      const [row] = await manager.execute<{
        id: string
        status: string
        confirmation_token_hash: string | null
        confirmation_token_expires_at: Date | null
        confirmation_token_consumed_hash: string | null
      }>(
        `select id, status, confirmation_token_hash, confirmation_token_expires_at, confirmation_token_consumed_hash
         from newsletter_subscriber
         where (confirmation_token_hash = ? or confirmation_token_consumed_hash = ?) and deleted_at is null
         for update`,
        [tokenHash, tokenHash]
      )

      if (!row) {
        return { outcome: "INVALID_OR_EXPIRED" as const }
      }

      if (row.confirmation_token_consumed_hash === tokenHash) {
        return row.status === SUBSCRIBER_STATUS.CONFIRMED
          ? { outcome: "ALREADY_CONFIRMED" as const }
          : { outcome: "INVALID_OR_EXPIRED" as const }
      }

      const notPending = row.status !== SUBSCRIBER_STATUS.PENDING
      const expired =
        !row.confirmation_token_expires_at ||
        row.confirmation_token_expires_at.getTime() <= Date.now()

      if (notPending || expired) {
        return { outcome: "INVALID_OR_EXPIRED" as const }
      }

      const unsubscribeToken = generateOpaqueToken()
      const unsubscribeTokenHash = hashToken(unsubscribeToken)

      await manager.execute(
        `update newsletter_subscriber
         set status = 'CONFIRMED', confirmed_at = now(), first_purchase_discount_eligible = true,
             confirmation_token_hash = null, confirmation_token_expires_at = null,
             confirmation_token_consumed_hash = ?, unsubscribe_token_hash = ?
         where id = ? and status = 'PENDING' and confirmation_token_hash = ?`,
        [tokenHash, unsubscribeTokenHash, row.id, tokenHash]
      )

      return {
        outcome: "CONFIRMED" as const,
        subscriberId: row.id,
        unsubscribeToken,
      }
    })
  }

  /**
   * Unsubscribes a subscriber from a plaintext unsubscribe token. The token
   * is hashed before lookup and is never invalidated on use — unsubscribing
   * must always remain possible — which makes repeated unsubscribe calls
   * naturally idempotent without a separate consumed-token marker.
   *
   * Race-safe against a concurrent (repeated) confirmation: confirmation's
   * success `UPDATE` never runs a second time for the same token (its
   * `WHERE` clause requires the still-active `confirmation_token_hash`,
   * which is cleared on first success), so a valid unsubscribe can never be
   * silently overwritten by a later confirmation attempt.
   */
  async unsubscribeSubscription(token: string): Promise<UnsubscribeResult> {
    const tokenHash = hashToken(token)

    return await this.manager_.transactional(async (manager) => {
      const [row] = await manager.execute<{ id: string; status: string }>(
        `select id, status from newsletter_subscriber
         where unsubscribe_token_hash = ? and deleted_at is null
         for update`,
        [tokenHash]
      )

      if (!row) {
        return { outcome: "INVALID" as const }
      }

      if (row.status === SUBSCRIBER_STATUS.UNSUBSCRIBED) {
        return { outcome: "ALREADY_UNSUBSCRIBED" as const }
      }

      await manager.execute(
        `update newsletter_subscriber
         set status = 'UNSUBSCRIBED', unsubscribed_at = now(), first_purchase_discount_eligible = false,
             confirmation_token_hash = null, confirmation_token_expires_at = null
         where id = ? and unsubscribe_token_hash = ? and status <> 'UNSUBSCRIBED'`,
        [row.id, tokenHash]
      )

      return { outcome: "UNSUBSCRIBED" as const }
    })
  }

  /**
   * Atomically increments the rate-limit bucket for `(requestKey,
   * windowStart)`, creating it with `count = 1` if it does not yet exist,
   * and returns the resulting count. Single `INSERT ... ON CONFLICT ...
   * DO UPDATE ... RETURNING` statement — Postgres guarantees this cannot
   * lose a concurrent increment (no separate select-then-write step, per
   * docs/decisions/0005). The `ON CONFLICT` target matches the partial
   * unique index Medusa generated for this soft-deletable model exactly
   * (`WHERE deleted_at IS NULL`), which Postgres requires for conflict
   * inference against a partial index.
   */
  async incrementRateLimitBucket(requestKey: string, windowStart: Date): Promise<number> {
    const newId = generateEntityId(undefined, "nlrl")
    const [row] = await this.manager_.execute<{ count: number }>(
      `insert into newsletter_rate_limit_bucket (id, request_key, window_start, count)
       values (?, ?, ?, 1)
       on conflict (request_key, window_start) where deleted_at is null
       do update set count = newsletter_rate_limit_bucket.count + 1
       returning count`,
      [newId, requestKey, windowStart]
    )
    return row.count
  }

  /**
   * Deletes rate-limit buckets whose `window_start` is older than `cutoff`
   * and returns the number of rows removed. Uses the indexed
   * `window_start` predicate. Bounded per call via `batchSize` (a plain
   * unbounded `DELETE` across a potentially large table is avoided);
   * callers (the scheduled job) may invoke this repeatedly — it is
   * idempotent and safe to run again immediately (a second run with the
   * same cutoff simply deletes zero rows).
   */
  async cleanupExpiredRateLimitBuckets(cutoff: Date, batchSize = 10_000): Promise<number> {
    const rows = await this.manager_.execute<{ id: string }>(
      `delete from newsletter_rate_limit_bucket
       where id in (
         select id from newsletter_rate_limit_bucket
         where window_start < ? and deleted_at is null
         order by window_start
         limit ?
       )
       returning id`,
      [cutoff, batchSize]
    )
    return rows.length
  }

  /**
   * Reserves the next confirmation-email send attempt for `subscriberId`,
   * bound to `confirmationTokenHash` — the hash of whichever token is
   * currently active on the row (Stage 2C.5). A single conditional
   * `UPDATE` is the entire concurrency control: it only succeeds when the
   * subscriber is still `PENDING`, the given hash still matches the row's
   * active `confirmation_token_hash` (a later rotation supersedes this
   * attempt), the resend cooldown has elapsed since the last accepted
   * send, and the current state is not an active/recent `SENDING`
   * reservation. `SENT`/`FAILED`/`NOT_SENT`/`UNKNOWN` are all valid
   * starting states for a fresh reservation — `confirmation_send_state`
   * is never reset on token rotation (`prepareSubscription` only rewrites
   * the token/consent columns), so a `SENT` left over from a previous
   * token generation must not permanently block the new generation from
   * ever being reserved again; the resend cooldown (not this state check)
   * is what actually throttles repeat sends, for the current token or
   * across a rotation alike. `SENDING` is the only state that blocks a
   * new reservation, and only while it is recent — a stale one (older
   * than `staleReservationCutoff`) is still reservable. No transaction is
   * held open across this call and the later network send — this is a
   * single, already-committed statement, exactly the "no open
   * transaction during the external call" requirement.
   *
   * On failure to reserve, a best-effort (non-locking) follow-up read
   * classifies *why*, for internal diagnostics only — the reservation
   * decision itself was already made correctly by the `UPDATE` above.
   */
  async reserveConfirmationEmailSend(input: {
    subscriberId: string
    confirmationTokenHash: string
    now: Date
    cooldownCutoff: Date
    staleReservationCutoff: Date
  }): Promise<ConfirmationEmailReservationOutcome> {
    const [reserved] = await this.manager_.execute<{ id: string }>(
      `update newsletter_subscriber
       set confirmation_send_state = 'SENDING', confirmation_send_reserved_at = ?
       where id = ?
         and confirmation_token_hash = ?
         and status = 'PENDING'
         and (confirmation_email_last_sent_at is null or confirmation_email_last_sent_at < ?)
         and (
           confirmation_send_state in ('NOT_SENT', 'SENT', 'FAILED', 'UNKNOWN')
           or (confirmation_send_state = 'SENDING' and confirmation_send_reserved_at < ?)
         )
       returning id`,
      [
        input.now,
        input.subscriberId,
        input.confirmationTokenHash,
        input.cooldownCutoff,
        input.staleReservationCutoff,
      ]
    )

    if (reserved) {
      return { reserved: true }
    }

    const [current] = await this.manager_.execute<{
      status: string
      confirmation_token_hash: string | null
      confirmation_email_last_sent_at: Date | null
    }>(
      `select status, confirmation_token_hash, confirmation_email_last_sent_at
       from newsletter_subscriber
       where id = ?`,
      [input.subscriberId]
    )

    if (!current || current.status !== SUBSCRIBER_STATUS.PENDING) {
      return { reserved: false, reason: "NOT_PENDING" }
    }
    if (current.confirmation_token_hash !== input.confirmationTokenHash) {
      return { reserved: false, reason: "STALE_TOKEN" }
    }
    if (
      current.confirmation_email_last_sent_at &&
      current.confirmation_email_last_sent_at >= input.cooldownCutoff
    ) {
      return { reserved: false, reason: "SUPPRESSED_COOLDOWN" }
    }
    return { reserved: false, reason: "ALREADY_IN_FLIGHT" }
  }

  /**
   * Finalises a reserved send as accepted by the provider. Still scoped by
   * `confirmationTokenHash` so a very late-arriving finalisation for an
   * already-rotated token cannot mark the wrong generation as sent.
   * Subscriber `status` is never touched here — provider success must
   * never confirm the subscriber or grant first-purchase eligibility.
   */
  async markConfirmationEmailSent(
    subscriberId: string,
    confirmationTokenHash: string,
    sentAt: Date
  ): Promise<void> {
    await this.manager_.execute(
      `update newsletter_subscriber
       set confirmation_send_state = 'SENT', confirmation_email_last_sent_at = ?
       where id = ? and confirmation_token_hash = ?`,
      [sentAt, subscriberId, confirmationTokenHash]
    )
  }

  /** Finalises a reserved send as a definitive provider failure. */
  async markConfirmationEmailFailed(
    subscriberId: string,
    confirmationTokenHash: string
  ): Promise<void> {
    await this.manager_.execute(
      `update newsletter_subscriber
       set confirmation_send_state = 'FAILED'
       where id = ? and confirmation_token_hash = ?`,
      [subscriberId, confirmationTokenHash]
    )
  }

  /**
   * Finalises a reserved send as an ambiguous outcome (timeout, network
   * disconnect after transmission, malformed response). Deliberately does
   * not touch `confirmation_email_last_sent_at` — the provider may or may
   * not have accepted the email, so this must not be recorded as a
   * confirmed send.
   */
  async markConfirmationEmailAmbiguous(
    subscriberId: string,
    confirmationTokenHash: string
  ): Promise<void> {
    await this.manager_.execute(
      `update newsletter_subscriber
       set confirmation_send_state = 'UNKNOWN'
       where id = ? and confirmation_token_hash = ?`,
      [subscriberId, confirmationTokenHash]
    )
  }
}

export default NewsletterModuleService
