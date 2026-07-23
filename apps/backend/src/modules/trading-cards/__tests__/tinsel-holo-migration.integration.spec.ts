import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260723140000 } from "../migrations/Migration20260723140000"

/**
 * Stage 1 remediation: the `trading_card_variant_special_treatment_check`
 * constraint never included TINSEL_HOLO even though the TypeScript enum, UI
 * and SKU generation already accepted it (Codex finding #2).
 */
let rootConnection: ReturnType<typeof createPgConnection>
let pgConnection: ReturnType<typeof createPgConnection>

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

const runMigration = async (direction: "up" | "down") => {
  const migration = new Migration20260723140000(undefined as never, undefined as never)
  await migration[direction]()
  for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
  migration.reset()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

const allowedValues = async (): Promise<string[]> => {
  const [row] = rows(await pgConnection.raw(
    `select pg_get_constraintdef(oid) as definition from pg_constraint
     where conname = 'trading_card_variant_special_treatment_check'`,
  ))
  const definition: string = row?.definition ?? ""
  // Postgres renders this constraint as either `IN (...)` or
  // `= ANY (ARRAY['VALUE'::text, ...])` depending on version, so both forms
  // must be recognised.
  const match = /in \(([^)]*)\)/i.exec(definition) ?? /array\[([^\]]*)\]/i.exec(definition)
  if (!match) return []
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/::\w+$/, "").replace(/^'|'$/g, ""))
}

async function fixtureVariantRow(specialTreatment: string) {
  const id = suffix()
  await pgConnection.raw(
    `insert into trading_card_set (id, game, language, display_name, provider_set_code) values (?, 'POKEMON', 'EN', ?, ?)`,
    [`tcset_tinsel_${id}`, `Tinsel Test Set ${id}`, `tinsel_set_${id}`],
  )
  await pgConnection.raw(
    `insert into trading_card (id, card_set_id, name, search_name, card_number, card_number_normalised, origin)
     values (?, ?, ?, ?, '001', '001', 'MANUAL')`,
    [`tc_tinsel_${id}`, `tcset_tinsel_${id}`, `Tinsel Test Card ${id}`, `tinsel test card ${id}`],
  )
  return pgConnection.transaction((transaction) => transaction.raw(
    `insert into trading_card_variant
       (id, trading_card_id, condition, condition_source, finish, finish_confirmed, special_treatment, special_treatment_confirmed, sku, origin, price_locked)
     values (?, ?, 'NEAR_MINT', 'EXPLICIT', 'NORMAL', true, ?, true, ?, 'MANUAL', false)`,
    [`tcvar_tinsel_${id}`, `tc_tinsel_${id}`, specialTreatment, `SKU-TINSEL-${id.toUpperCase()}`],
  ))
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  await runMigration("down")
})

afterAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

describe("Migration20260723140000 (TINSEL_HOLO constraint)", () => {
  it("supports up/up/down/down/up cleanly, adding TINSEL_HOLO exactly once and preserving every other value", async () => {
    const beforeUp = await allowedValues()
    expect(beforeUp).not.toContain("TINSEL_HOLO")
    const priorCount = beforeUp.length

    await runMigration("up")
    const afterFirstUp = await allowedValues()
    expect(afterFirstUp.filter((value) => value === "TINSEL_HOLO")).toHaveLength(1)
    expect(afterFirstUp).toHaveLength(priorCount + 1)
    expect(afterFirstUp).toEqual(expect.arrayContaining(beforeUp))

    await runMigration("up")
    expect((await allowedValues()).sort()).toEqual(afterFirstUp.sort())

    await runMigration("down")
    const afterDown = await allowedValues()
    expect(afterDown).not.toContain("TINSEL_HOLO")
    expect(afterDown.sort()).toEqual(beforeUp.sort())

    await runMigration("down")
    expect((await allowedValues()).sort()).toEqual(afterDown.sort())

    await runMigration("up")
    expect((await allowedValues()).sort()).toEqual(afterFirstUp.sort())
  }, 60000)

  it("rejects TINSEL_HOLO before the migration runs and accepts it after", async () => {
    await runMigration("down")
    await expect(fixtureVariantRow("TINSEL_HOLO")).rejects.toThrow(/check constraint|special_treatment/i)

    await runMigration("up")
    await expect(fixtureVariantRow("TINSEL_HOLO")).resolves.toBeDefined()
  }, 60000)

  it("still accepts every pre-existing special_treatment value after the migration runs (safe for an existing populated database)", async () => {
    await runMigration("up")
    for (const value of ["NONE", "COSMOS_HOLO", "GALAXY_HOLO", "STAMPED", "OTHER"]) {
      await expect(fixtureVariantRow(value)).resolves.toBeDefined()
    }
  }, 60000)
})
