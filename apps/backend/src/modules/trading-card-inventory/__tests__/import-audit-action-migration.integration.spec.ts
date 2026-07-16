import { createPgConnection } from "@medusajs/framework/utils"
import { Migration20260716190000 } from "../migrations/Migration20260716190000"

let pgConnection: ReturnType<typeof createPgConnection>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

const runMigration = async (direction: "up" | "down") => {
  const migration = new Migration20260716190000(undefined as never, undefined as never)
  await migration[direction]()
  for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
  migration.reset()
}

const constraintDefinition = async () => {
  const [row] = rows(await pgConnection.raw(
    `select pg_get_constraintdef(oid) as definition from pg_constraint
     where conname = 'trading_card_inventory_audit_entry_action_check'`,
  ))
  return row?.definition as string | undefined
}

beforeAll(() => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
})

afterAll(async () => {
  await runMigration("up")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
})

describe("Stage 5B.1 Slice 2 import audit-action migration", () => {
  it("supports up/up/down/down/up cleanly, only ever widening or narrowing the action CHECK constraint", async () => {
    await runMigration("up")
    const afterFirstUp = await constraintDefinition()
    expect(afterFirstUp).toContain("IMPORT_STARTED")
    expect(afterFirstUp).toContain("IMPORT_FAILED")
    expect(afterFirstUp).toContain("SOURCE_CREATED")

    await runMigration("up")
    expect(await constraintDefinition()).toBe(afterFirstUp)

    await runMigration("down")
    const afterDown = await constraintDefinition()
    expect(afterDown).not.toContain("IMPORT_STARTED")
    expect(afterDown).toContain("SOURCE_CREATED")

    await runMigration("down")
    expect(await constraintDefinition()).toBe(afterDown)

    await runMigration("up")
    expect(await constraintDefinition()).toBe(afterFirstUp)
  }, 60000)

  it("accepts every new IMPORT_* action and still rejects an unrecognised action at the database level", async () => {
    await runMigration("up")
    const sourceId = `tcisrc_importaudittest_${Date.now().toString(36)}`
    await pgConnection.raw(
      `insert into trading_card_inventory_source (id, display_name, normalized_name, provider) values (?, ?, ?, 'PULSE')`,
      [sourceId, "Import Audit Test Source", `import audit test source ${sourceId}`],
    )
    const importActions = [
      "IMPORT_STARTED", "IMPORT_DUPLICATE_DETECTED", "IMPORT_VALIDATION_FAILED", "IMPORT_ENTRIES_PERSISTED",
      "IMPORT_MATCHING_COMPLETED", "IMPORT_RECONCILIATION_STARTED", "IMPORT_RECONCILIATION_COMPLETED", "IMPORT_FAILED",
    ]
    for (const action of importActions) {
      await expect(pgConnection.raw(
        `insert into trading_card_inventory_audit_entry (id, actor, entity_type, entity_id, action, source)
         values (?, 'test-actor', 'INVENTORY_SOURCE', ?, ?, 'PULSE')`,
        [`tciaud_${action.toLowerCase()}_${Date.now().toString(36)}`, sourceId, action],
      )).resolves.toBeDefined()
    }
    await expect(pgConnection.raw(
      `insert into trading_card_inventory_audit_entry (id, actor, entity_type, entity_id, action, source)
       values (?, 'test-actor', 'INVENTORY_SOURCE', ?, 'NOT_A_REAL_ACTION', 'PULSE')`,
      [`tciaud_bogus_${Date.now().toString(36)}`, sourceId],
    )).rejects.toThrow(/trading_card_inventory_audit_entry_action_check|check constraint/i)

    await pgConnection.raw(`delete from trading_card_inventory_audit_entry where entity_id = ?`, [sourceId])
    await pgConnection.raw(`delete from trading_card_inventory_source where id = ?`, [sourceId])
  }, 60000)
})
