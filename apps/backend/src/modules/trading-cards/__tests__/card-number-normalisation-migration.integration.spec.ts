import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260718160000 } from "../migrations/Migration20260718160000"

jest.setTimeout(60000)

let rootConnection: ReturnType<typeof createPgConnection>
let pgConnection: ReturnType<typeof createPgConnection>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

async function run(migration: { up(): Promise<void>; down(): Promise<void>; getQueries(): unknown[]; reset(): void }, direction: "up" | "down") {
  await migration[direction]()
  for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
  migration.reset()
}

const newCardNumberMigration = () => new Migration20260718160000(undefined as never, undefined as never)

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

async function createSet() {
  const id = `tcset_cnmigtest_${suffix()}`
  await pgConnection.raw(
    `insert into trading_card_set (id, game, language, display_name, provider_set_code)
     values (?, 'POKEMON', 'EN', ?, ?)`,
    [id, `Card Number Migration Test Set ${id}`, `cnmigtest-${id}`],
  )
  return id
}

async function createCard(setId: string, cardNumber: string, cardNumberNormalised: string) {
  const id = `tcard_cnmigtest_${suffix()}`
  await pgConnection.raw(
    `insert into trading_card (id, card_set_id, name, search_name, card_number, card_number_normalised)
     values (?, ?, 'Migration Test Card', 'migration test card', ?, ?)`,
    [id, setId, cardNumber, cardNumberNormalised],
  )
  return id
}

async function cardNumberNormalised(id: string): Promise<string> {
  const [row] = rows(await pgConnection.raw(`select card_number_normalised from trading_card where id = ?`, [id]))
  return row?.card_number_normalised as string
}

// Same SAVEPOINT reasoning as live-content-hash-discard-migration.integration.spec.ts:
// an expected failure must run inside its own nested transaction, otherwise
// the bare failed query poisons the outer per-file transaction for every
// later statement until rollback.
const expectMigrationFailure = async (
  migration: { up(): Promise<void>; getQueries(): unknown[] },
  pattern: RegExp,
) => {
  await migration.up()
  const queries = migration.getQueries().map(String)
  await expect(pgConnection.transaction(async (transaction: { raw: (q: string) => Promise<unknown> }) => {
    for (const query of queries) await transaction.raw(query)
  })).rejects.toThrow(pattern)
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = await rootConnection.transaction() as never
})

afterAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (rootConnection as any)?.context?.destroy()
  await rootConnection?.destroy()
})

describe("Phase 8B card_number_normalised compatibility migration (Migration20260718160000)", () => {
  it("re-normalises a legacy denominator-inclusive value", async () => {
    const setId = await createSet()
    const id = await createCard(setId, "044/072", "044/072")

    await run(newCardNumberMigration(), "up")

    expect(await cardNumberNormalised(id)).toBe("044")
  })

  it("re-normalises a legacy lowercase-suffix value", async () => {
    const setId = await createSet()
    const id = await createCard(setId, "025a", "025a")

    await run(newCardNumberMigration(), "up")

    expect(await cardNumberNormalised(id)).toBe("025A")
  })

  it("re-normalises a legacy value with both a denominator and a lowercase suffix", async () => {
    const setId = await createSet()
    const id = await createCard(setId, "025a/072", "025a/072")

    await run(newCardNumberMigration(), "up")

    expect(await cardNumberNormalised(id)).toBe("025A")
  })

  it("preserves leading zeros", async () => {
    const setId = await createSet()
    const id = await createCard(setId, "0104/15", "0104/15")

    await run(newCardNumberMigration(), "up")

    expect(await cardNumberNormalised(id)).toBe("0104")
  })

  it("leaves an already-current-shaped value untouched", async () => {
    const setId = await createSet()
    const id = await createCard(setId, "066", "066")

    await run(newCardNumberMigration(), "up")

    expect(await cardNumberNormalised(id)).toBe("066")
  })

  it("is idempotent — a second run makes no further changes", async () => {
    const setId = await createSet()
    const id = await createCard(setId, "088/150", "088/150")

    await run(newCardNumberMigration(), "up")
    expect(await cardNumberNormalised(id)).toBe("088")
    await run(newCardNumberMigration(), "up")
    expect(await cardNumberNormalised(id)).toBe("088")
  })

  it(
    "detects a collision produced by re-normalisation and aborts without merging, deleting or updating either row",
    async () => {
      const setId = await createSet()
      // Two distinct existing cards that would both re-normalise to "044"
      // under the new algorithm — a legitimate scenario if one was ever
      // entered with its denominator and the other without.
      const legacyId = await createCard(setId, "044/072", "044/072")
      const alreadyCurrentId = await createCard(setId, "044", "044")

      await expectMigrationFailure(newCardNumberMigration(), /collision/i)

      // Neither row was touched — the migration failed before any UPDATE committed.
      expect(await cardNumberNormalised(legacyId)).toBe("044/072")
      expect(await cardNumberNormalised(alreadyCurrentId)).toBe("044")

      // This deliberately-unresolved collision must not leak into later
      // tests in this file — the migration scans the *whole* table, and
      // every test in this file shares one outer (never-committed)
      // transaction, so a left-behind colliding pair would make every
      // subsequent `up()` in this suite fail on this stale collision
      // instead of whatever it's actually testing.
      await pgConnection.raw(`delete from trading_card where id in (?, ?)`, [legacyId, alreadyCurrentId])
    },
  )

  it("does not touch rows in a different card set that would not collide", async () => {
    const setA = await createSet()
    const setB = await createSet()
    const idA = await createCard(setA, "044/072", "044/072")
    const idB = await createCard(setB, "044", "044")

    // No collision: different card_set_id, so both may normalise to "044" independently.
    await run(newCardNumberMigration(), "up")

    expect(await cardNumberNormalised(idA)).toBe("044")
    expect(await cardNumberNormalised(idB)).toBe("044")
  })

  it("down() refuses to run — the migration is not reversible", async () => {
    await expect(newCardNumberMigration().down()).rejects.toThrow("not reversible")
  })
})
