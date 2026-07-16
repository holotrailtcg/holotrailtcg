import { Client } from "pg"
import { MedusaError } from "@medusajs/framework/utils"
import { CARD_IMAGE_ORPHAN_LOCK_NAMESPACE } from "../types"
import { MANAGED_FINAL_PREFIX, MANAGED_STAGING_PREFIX } from "./managed-prefixes"

/**
 * Stage 4B.4 Slice 2: a genuine PostgreSQL *session*-level advisory lock
 * (`pg_advisory_lock`/`pg_advisory_unlock`, not the transaction-scoped
 * `_xact_lock` variant used elsewhere in this module), so it can be held
 * across the R2 network calls a reconciliation run makes without requiring
 * a MikroORM/Knex transaction to stay open for that whole duration. A
 * session-level lock only means what it says if lock, work, and unlock all
 * happen on the exact same physical connection, so this opens one dedicated
 * `pg.Client` per run rather than borrowing from the pooled connection the
 * rest of the module uses — a lock acquired on one pooled connection and
 * "released" from a different one is a silent no-op that leaks the lock
 * until that connection is evicted.
 *
 * This project's `DATABASE_URL` may point at a PgBouncer-style connection
 * pooler in transaction-pooling mode (confirmed against this project's own
 * Neon pooled test endpoint), which resets session state — including
 * session-level advisory locks — between separate autocommitted statements,
 * even on what looks like one stable `pg.Client` connection. Two bare,
 * separately-issued `pg_try_advisory_lock`/`pg_advisory_unlock` statements
 * are therefore not reliable through such a pooler. The fix verified
 * against this project's real test database: wrap the acquire → hold →
 * release sequence in one explicit `BEGIN`/`COMMIT` on the dedicated
 * client — this is what actually pins the pooler's backend connection for
 * the run's whole duration, not the fact of using a dedicated `pg.Client`
 * alone. This transaction takes zero row locks and performs zero writes —
 * only the advisory-lock calls themselves — so it never blocks or is
 * blocked by other application traffic; it exists purely to keep the
 * pooler from reassigning the backend mid-run, not for row-level isolation.
 *
 * Uses the two-int form of `pg_try_advisory_lock`/`pg_advisory_unlock`
 * (a fixed namespace plus a per-prefix key) rather than hashing the prefix
 * string: there are only ever two managed prefixes, so an explicit map is
 * simpler and fully deterministic, with no dependency on a hash function's
 * output remaining stable across PostgreSQL versions.
 */

const PREFIX_LOCK_KEYS: Record<string, number> = {
  [MANAGED_STAGING_PREFIX]: 0,
  [MANAGED_FINAL_PREFIX]: 1,
}

export interface PrefixReconciliationLease {
  acquired: boolean
  /** Idempotent: safe to call more than once, and always safe to call even if `acquired` is false. */
  release(): Promise<void>
}

const NOOP_RELEASE = async (): Promise<void> => {}

async function endQuietly(client: Client): Promise<void> {
  try {
    await client.end()
  } catch {
    // Best-effort only: a failure to close an already-broken connection is never itself an error worth surfacing.
  }
}

async function rollbackQuietly(client: Client): Promise<void> {
  try {
    await client.query("ROLLBACK")
  } catch {
    // Best-effort only: the connection may already be unusable, in which case `endQuietly` below is what actually matters.
  }
}

/**
 * Attempts a non-blocking lock for `prefix` (must be one of the two managed
 * prefix constants). Returns `{ acquired: false }` immediately, without
 * waiting, if another run already holds it — the caller treats that as
 * "already running, skip this tick," never as an error. Never logs or
 * throws `databaseUrl` (it may contain credentials).
 */
export async function acquirePrefixReconciliationLock(
  databaseUrl: string,
  prefix: string
): Promise<PrefixReconciliationLease> {
  const lockKey = PREFIX_LOCK_KEYS[prefix]
  if (lockKey === undefined) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A reconciliation lock may only be requested for a managed R2 prefix"
    )
  }

  const client = new Client({ connectionString: databaseUrl })

  let locked: boolean
  try {
    await client.connect()
    await client.query("BEGIN")
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1, $2) as locked",
      [CARD_IMAGE_ORPHAN_LOCK_NAMESPACE, lockKey]
    )
    locked = result.rows[0]?.locked === true
  } catch {
    await rollbackQuietly(client)
    await endQuietly(client)
    // Never surface a raw pg/connection-string error to a caller.
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The reconciliation lock could not be acquired")
  }

  if (!locked) {
    // No lock held on this connection — safe to end the transaction and close normally.
    await client.query("COMMIT").catch(() => rollbackQuietly(client))
    await endQuietly(client)
    return { acquired: false, release: NOOP_RELEASE }
  }

  let released = false
  return {
    acquired: true,
    async release() {
      if (released) return
      released = true
      try {
        await client.query("select pg_advisory_unlock($1, $2)", [CARD_IMAGE_ORPHAN_LOCK_NAMESPACE, lockKey])
        await client.query("COMMIT")
      } catch {
        await rollbackQuietly(client)
      } finally {
        await endQuietly(client)
      }
    },
  }
}
