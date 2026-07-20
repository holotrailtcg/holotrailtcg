import { randomBytes, randomUUID } from "node:crypto"
import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import { EBAY_INTEGRATION_MODULE } from "../index"
import { encryptRefreshToken } from "../crypto/token-encryption"
import { hashOAuthState } from "../oauth/state"
import { Migration20260720100000 } from "../migrations/Migration20260720100000"
import { Migration20260720110000 } from "../migrations/Migration20260720110000"
import { Migration20260720120000 } from "../migrations/Migration20260720120000"
import { createEbayTokenService } from "../token-service"
import type { EbayEnvironmentConfig } from "../config"
import type { EbayOAuthClient } from "../dependencies"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any
const keyring = { activeVersion: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) }
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  const previewsDown = new Migration20260720120000(undefined as never, undefined as never)
  await previewsDown.down()
  for (const query of previewsDown.getQueries().map(String)) await pgConnection.raw(query)
  const categoriesDown = new Migration20260720110000(undefined as never, undefined as never)
  await categoriesDown.down()
  for (const query of categoriesDown.getQueries().map(String)) await pgConnection.raw(query)
  const down = new Migration20260720100000(undefined as never, undefined as never)
  await down.down()
  for (const query of down.getQueries().map(String)) await pgConnection.raw(query)
  const up = new Migration20260720100000(undefined as never, undefined as never)
  await up.up()
  for (const query of up.getQueries().map(String)) await pgConnection.raw(query)
  const categories = new Migration20260720110000(undefined as never, undefined as never)
  await categories.up()
  for (const query of categories.getQueries().map(String)) await pgConnection.raw(query)
  const previews = new Migration20260720120000(undefined as never, undefined as never)
  await previews.up()
  for (const query of previews.getQueries().map(String)) await pgConnection.raw(query)
  medusaApp = await MedusaApp({
    modulesConfig: {
      [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" },
      [Modules.LOCKING]: {
        resolve: "@medusajs/medusa/locking",
        options: { providers: [{
          resolve: "@medusajs/medusa/locking-postgres", id: "locking-postgres", is_default: true,
        }] },
      },
    },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection }, cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[EBAY_INTEGRATION_MODULE]
}, 60_000)

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

async function begin(environment: "SANDBOX" | "PRODUCTION", actorId = `actor-${suffix()}`, expiresAt = new Date(Date.now() + 60_000)) {
  const state = `state-${suffix()}`
  const attemptId = randomUUID()
  const result = await service.beginConnection({
    environment, actorId, attemptId, stateHash: hashOAuthState(state), expiresAt,
    reconnect: true, correlationId: randomUUID(),
  })
  return { ...result, state, actorId, attemptId }
}

async function complete(attempt: any, tokenValue = "secret-refresh-token") {
  await service.consumeOAuthState({ stateHash: hashOAuthState(attempt.state), environment: attempt.connection.environment })
  return service.completeConnection({
    environment: attempt.connection.environment, actorId: attempt.actorId, attemptId: attempt.attemptId,
    accountId: `account-${suffix()}`, displayName: "Seller", encryptedToken: encryptRefreshToken(tokenValue, keyring),
    grantedScopes: ["identity"], accessTokenExpiresAt: new Date(Date.now() + 3_600_000), correlationId: randomUUID(),
  })
}

describe("eBay integration module", () => {
  it("enforces Store category hierarchy directly in PostgreSQL", async () => {
    const scope = `scope-${suffix()}`
    const insert = (id: string, external: string, parent: string | null, level: number, environment = "SANDBOX", account = scope) => pgConnection.raw(
      `insert into ebay_integration_store_category (id,environment,ebay_account_id,external_id,name,parent_external_id,sibling_order,level,path,status,source) values (?,?,?,?,?,?,0,?,'path','ACTIVE','MANUAL')`,
      [id, environment, account, external, external, parent, level]
    )
    await expect(insert(`root-${scope}`, "24393782015", null, 1)).resolves.toBeDefined()
    await expect(insert(`child-${scope}`, "child", "24393782015", 2)).resolves.toBeDefined()
    await expect(insert(`third-${scope}`, "third", "child", 3)).resolves.toBeDefined()
    await expect(insert(`fourth-${scope}`, "fourth", "third", 4)).rejects.toThrow()
    await expect(insert(`self-${scope}`, "self", "self", 2)).rejects.toThrow()
    await expect(insert(`wrong-${scope}`, "wrong", "24393782015", 3)).rejects.toThrow()
    await expect(insert(`other-${scope}`, "other", "24393782015", 2, "PRODUCTION", `other-${scope}`)).rejects.toThrow()
    await expect(insert(`same-prod-${scope}`, "24393782015", null, 1, "PRODUCTION", `other-${scope}`)).resolves.toBeDefined()
    await expect(insert(`duplicate-${scope}`, "24393782015", null, 1)).rejects.toThrow()
    await expect(pgConnection.raw(`update ebay_integration_store_category set parent_external_id = 'child', level = 3 where id = ?`, [`root-${scope}`])).rejects.toThrow()
  })

  it("previews and atomically applies a complete Store category CSV without numeric ID coercion", async () => {
    const attempt = await begin("PRODUCTION", `catalogue-${suffix()}`)
    await complete(attempt)
    const csv = [
      "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
      "24393782015,Promos,,10",
      "24393788015,Mega,24393782015,10",
      "24393799015,Special,24393788015,10",
    ].join("\n")
    const preview = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv, actorId: "admin", correlationId: randomUUID() })
    expect(preview).toMatchObject({ valid: true, added: ["24393782015", "24393788015", "24393799015"] })
    expect((await service.listStoreCategories("PRODUCTION")).categories).toHaveLength(0)
    const applied = await service.applyStoreCategoryCsv({ previewId: preview.previewId, csv, actorId: "admin", correlationId: randomUUID() })
    expect(applied.categories.map((category: any) => category.externalId)).toContain("24393782015")
    const root = applied.categories.find((category: any) => category.externalId === "24393782015")!
    const changedCsv = [
      "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order", "24393782015,Promos renamed,,11",
    ].join("\n")
    const changedPreview = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: changedCsv, actorId: "admin", correlationId: randomUUID() })
    const changed = await service.applyStoreCategoryCsv({ previewId: changedPreview.previewId, csv: changedCsv, actorId: "admin", correlationId: randomUUID() })
    expect(changed.categories.find((category: any) => category.externalId === "24393782015")).toMatchObject({ id: root.id, name: "Promos renamed", siblingOrder: 11 })
    expect(changed.categories.filter((category: any) => category.status === "REMOVED")).toHaveLength(2)
    const badPreview = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: "bad", actorId: "admin", correlationId: randomUUID() })
    await expect(service.applyStoreCategoryCsv({ previewId: badPreview.previewId, csv: "bad", actorId: "admin", correlationId: randomUUID() })).rejects.toThrow()
    expect((await service.listStoreCategories("PRODUCTION")).categories.find((category: any) => category.externalId === "24393782015")?.name).toBe("Promos renamed")
  })
  it("binds imports to an unexpired actor-owned preview, exact bytes, and unchanged catalogue", async () => {
    const exactCsv = "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\n24393782015,Bound preview,,12\n"
    const before = await service.listStoreCategories("PRODUCTION")
    const mismatch = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })
    await expect(service.applyStoreCategoryCsv({ previewId: mismatch.previewId, csv: `${exactCsv}\n`, actorId: "preview-owner", correlationId: randomUUID() })).rejects.toThrow("Preview again")
    expect((await service.listStoreCategories("PRODUCTION")).categories).toEqual(before.categories)

    const unauthorized = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })
    await expect(service.applyStoreCategoryCsv({ previewId: unauthorized.previewId, csv: exactCsv, actorId: "other-actor", correlationId: randomUUID() })).rejects.toThrow("Preview again")

    const expired = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })
    await pgConnection.raw("update ebay_integration_store_category_import_preview set expires_at=now() - interval '1 second' where id=?", [expired.previewId])
    await expect(service.applyStoreCategoryCsv({ previewId: expired.previewId, csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })).rejects.toThrow("Preview again")

    const stale = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })
    await service.createStoreCategory({ environment: "PRODUCTION", externalId: `stale-${suffix()}`, name: "Concurrent local change", parentExternalId: null, siblingOrder: 99, actorId: "other-admin", correlationId: randomUUID() })
    await expect(service.applyStoreCategoryCsv({ previewId: stale.previewId, csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })).rejects.toThrow("Preview again")

    const successful = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })
    await expect(service.applyStoreCategoryCsv({ previewId: successful.previewId, csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })).resolves.toBeDefined()
    await expect(service.applyStoreCategoryCsv({ previewId: successful.previewId, csv: exactCsv, actorId: "preview-owner", correlationId: randomUUID() })).rejects.toThrow("Preview again")
    const stored = rows(await pgConnection.raw("select csv_sha256,catalogue_fingerprint,safe_summary::text as safe_summary,status,consumed_at from ebay_integration_store_category_import_preview where id=?", [successful.previewId]))[0]
    expect(stored.csv_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.catalogue_fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.consumed_at).toBeTruthy()
    expect(stored.status).toBe("CONSUMED")
    expect(stored.safe_summary).not.toContain(exactCsv)
  })

  it("requires every complete-snapshot parent in the same CSV and does not remove on failure", async () => {
    const parentId = `parent-${suffix()}`
    const childId = `child-${suffix()}`
    await service.createStoreCategory({ environment: "PRODUCTION", externalId: parentId, name: "Existing omitted parent", parentExternalId: null, siblingOrder: 1, actorId: "admin", correlationId: randomUUID() })
    const invalidCsv = `ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\n${childId},Child,${parentId},1\n`
    const invalidPreview = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: invalidCsv, actorId: "admin", correlationId: randomUUID() })
    expect(invalidPreview.valid).toBe(false)
    expect(invalidPreview.invalid).toContain(`Category ${childId} has a missing parent.`)
    await expect(service.applyStoreCategoryCsv({ previewId: invalidPreview.previewId, csv: invalidCsv, actorId: "admin", correlationId: randomUUID() })).rejects.toThrow("invalid")
    expect((await service.listStoreCategories("PRODUCTION")).categories.find((category: any) => category.externalId === parentId)?.status).toBe("ACTIVE")

    const validCsv = `ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\n${parentId},Included parent,,1\n${childId},Child,${parentId},1\n`
    const validPreview = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: validCsv, actorId: "admin", correlationId: randomUUID() })
    expect(validPreview.valid).toBe(true)
    await expect(service.applyStoreCategoryCsv({ previewId: validPreview.previewId, csv: validCsv, actorId: "admin", correlationId: randomUUID() })).resolves.toBeDefined()
  })

  it("removes descendants by the scoped parent graph rather than display-path prefixes", async () => {
    const targetId = `graph-root-${suffix()}`
    const childId = `graph-child-${suffix()}`
    const lookalikeId = `graph-lookalike-${suffix()}`
    const target = await service.createStoreCategory({ environment: "PRODUCTION", externalId: targetId, name: "Graph root", parentExternalId: null, siblingOrder: 1, actorId: "admin", correlationId: randomUUID() })
    await service.createStoreCategory({ environment: "PRODUCTION", externalId: childId, name: "Real child", parentExternalId: targetId, siblingOrder: 1, actorId: "admin", correlationId: randomUUID() })
    await service.createStoreCategory({ environment: "PRODUCTION", externalId: lookalikeId, name: "Graph root / unrelated", parentExternalId: null, siblingOrder: 2, actorId: "admin", correlationId: randomUUID() })
    await pgConnection.raw(`insert into ebay_integration_store_category (id,environment,ebay_account_id,external_id,name,parent_external_id,sibling_order,level,path,status,source) values (?, 'SANDBOX', ?, ?, 'Graph root / unrelated', null, 1, 1, 'Graph root / unrelated', 'ACTIVE', 'MANUAL')`, [`other-${suffix()}`, `other-account-${suffix()}`, lookalikeId])
    await expect(service.removeStoreCategory({ environment: "PRODUCTION", id: target.id, reason: "Graph removal", actorId: "admin", correlationId: randomUUID() })).resolves.toEqual({ removed: 2 })
    const catalogue = await service.listStoreCategories("PRODUCTION")
    expect(catalogue.categories.find((category: any) => category.externalId === childId)?.status).toBe("REMOVED")
    expect(catalogue.categories.find((category: any) => category.externalId === lookalikeId)?.status).toBe("ACTIVE")
    expect(rows(await pgConnection.raw("select status from ebay_integration_store_category where environment='SANDBOX' and external_id=?", [lookalikeId]))[0].status).toBe("ACTIVE")
  })

  it("denies every generated Store-category and category-audit mutation bypass", async () => {
    const generatedBypasses = [
      "createEbayStoreCategories", "updateEbayStoreCategories", "deleteEbayStoreCategories", "softDeleteEbayStoreCategories", "restoreEbayStoreCategories",
      "createEbayStoreCategoryAudits", "updateEbayStoreCategoryAudits", "deleteEbayStoreCategoryAudits", "softDeleteEbayStoreCategoryAudits", "restoreEbayStoreCategoryAudits",
    ]
    for (const method of generatedBypasses) await expect(service[method]()).rejects.toThrow("domain-owned")
    await expect(service.createStoreCategory({ environment: "PRODUCTION", externalId: `domain-${suffix()}`, name: "Domain method remains available", parentExternalId: null, siblingOrder: 1, actorId: "admin", correlationId: randomUUID() })).resolves.toBeDefined()
  })

  it("records bounded reconstructable manual and complete-import audit history", async () => {
    const externalId = `audit-${suffix()}`
    const created = await service.createStoreCategory({ environment: "PRODUCTION", externalId, name: "Before audit edit", parentExternalId: null, siblingOrder: 4, actorId: "audit-admin", correlationId: randomUUID() })
    await service.updateStoreCategory({ environment: "PRODUCTION", id: created.id, name: "After audit edit", parentExternalId: null, siblingOrder: 5, actorId: "audit-admin", correlationId: randomUUID() })
    const history = await service.listStoreCategoryAudits("PRODUCTION", 100)
    const edit = history.audits.find((audit: any) => audit.action === "MANUAL_EDITED" && audit.categoryId === created.id)!
    expect(edit.actorId).toBe("audit-admin")
    expect(edit.details).toMatchObject({ before: { externalId, name: "Before audit edit", siblingOrder: 4, status: "ACTIVE" }, after: { externalId, name: "After audit edit", siblingOrder: 5, status: "ACTIVE" } })

    const importCsv = `ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\n${externalId},Imported audit edit,,6\nimport-added-${suffix()},Imported addition,,7\n`
    const preview = await service.previewStoreCategoryCsv({ environment: "PRODUCTION", csv: importCsv, actorId: "audit-admin", correlationId: randomUUID() })
    await service.applyStoreCategoryCsv({ previewId: preview.previewId, csv: importCsv, actorId: "audit-admin", correlationId: randomUUID() })
    const imported = await service.listStoreCategoryAudits("PRODUCTION", 100)
    const summary = imported.audits.find((audit: any) => audit.action === "CSV_IMPORT_APPLIED" && audit.details?.previewId === preview.previewId)!
    expect(summary.details).toMatchObject({ csvSha256: expect.stringMatching(/^[a-f0-9]{64}$/), counts: { added: 1, changed: 1 }, ids: { added: expect.any(Array), changed: [externalId] }, truncated: false })
    expect(imported.audits.some((audit: any) => audit.action === "CSV_CATEGORY_CHANGED" && audit.details?.before?.name === "After audit edit" && audit.details?.after?.name === "Imported audit edit")).toBe(true)
    await pgConnection.raw(`insert into ebay_integration_store_category_audit (id,environment,ebay_account_id,actor_id,action,correlation_id,details) values (?, 'PRODUCTION', ?, 'other-actor', 'MANUAL_EDITED', ?, '{}'::jsonb)`, [`other-audit-${suffix()}`, `other-account-${suffix()}`, randomUUID()])
    expect((await service.listStoreCategoryAudits("PRODUCTION", 100)).audits.some((audit: any) => audit.actorId === "other-actor")).toBe(false)
    const persisted = JSON.stringify(rows(await pgConnection.raw("select details from ebay_integration_store_category_audit where ebay_account_id=?", [history.accountId])))
    expect(persisted).not.toContain(importCsv)
    expect(JSON.stringify(imported)).not.toMatch(/refresh_token|ciphertext|provider_response/i)
  })
  it("enforces the lifecycle truth table directly in PostgreSQL for nullable and partial fields", async () => {
    const validUuid = () => randomUUID()
    const insert = async (status: string, overrides: Record<string, unknown> = {}) => {
      await pgConnection.raw(`delete from ebay_integration_connection where id like 'constraint-%'`)
      const values = {
        id: `constraint-${suffix()}`, environment: "SANDBOX", status,
        current_attempt_id: null as string | null, credential_generation: null as string | null,
        refresh_operation_id: null as string | null, refresh_operation_started_at: null as string | null,
        refresh_token_ciphertext: null as string | null, refresh_token_iv: null as string | null,
        refresh_token_auth_tag: null as string | null, encryption_key_version: null as string | null,
        ...overrides,
      }
      const columns = Object.keys(values)
      await pgConnection.raw(
        `insert into ebay_integration_connection (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`,
        columns.map((key) => values[key as keyof typeof values])
      )
    }
    const material = () => ({ refresh_token_ciphertext: "ciphertext", refresh_token_iv: "iv", refresh_token_auth_tag: "tag", encryption_key_version: "v1", credential_generation: validUuid() })
    const active = () => ({ ...material(), current_attempt_id: validUuid() })

    await expect(insert("CONNECTING", { current_attempt_id: validUuid() })).resolves.toBeUndefined()
    await expect(insert("CONNECTING")).rejects.toThrow()
    await expect(insert("CONNECTED", active())).resolves.toBeUndefined()
    await expect(insert("DEGRADED", active())).resolves.toBeUndefined()
    await expect(insert("REFRESH_REQUIRED", active())).resolves.toBeUndefined()
    await expect(insert("DISCONNECTING")).resolves.toBeUndefined()
    await expect(insert("REVOKED")).resolves.toBeUndefined()
    await expect(insert("DISCONNECTED")).resolves.toBeUndefined()
    await expect(insert("ERROR")).resolves.toBeUndefined()

    await expect(insert("CONNECTED")).rejects.toThrow()
    await expect(insert("CONNECTED", { ...material(), credential_generation: null, current_attempt_id: validUuid() })).rejects.toThrow()
    await expect(insert("CONNECTED", { current_attempt_id: validUuid(), refresh_token_ciphertext: "ciphertext" })).rejects.toThrow()
    await expect(insert("DEGRADED", { current_attempt_id: validUuid() })).rejects.toThrow()
    await expect(insert("REFRESH_REQUIRED", { current_attempt_id: validUuid() })).rejects.toThrow()
    for (const status of ["DISCONNECTED", "REVOKED"]) {
      await expect(insert(status, { ...material() })).rejects.toThrow()
      await expect(insert(status, { current_attempt_id: validUuid() })).rejects.toThrow()
    }
    await expect(insert("DISCONNECTING", { current_attempt_id: validUuid() })).rejects.toThrow()
    await expect(insert("DISCONNECTING", { refresh_operation_id: validUuid(), refresh_operation_started_at: new Date() })).rejects.toThrow()
    for (const status of ["CONNECTING", "REFRESH_REQUIRED", "DISCONNECTING", "REVOKED", "DISCONNECTED", "ERROR"]) {
      await expect(insert(status, { ...active(), refresh_operation_id: validUuid(), refresh_operation_started_at: new Date() })).rejects.toThrow()
    }
    await expect(insert("CONNECTED", { ...active(), refresh_operation_id: validUuid() })).rejects.toThrow()
    await expect(insert("CONNECTED", { ...active(), refresh_operation_started_at: new Date() })).rejects.toThrow()
    await expect(insert("CONNECTED", { current_attempt_id: validUuid(), credential_generation: validUuid() })).rejects.toThrow()
    await expect(insert("CONNECTED", { ...material(), credential_generation: null, current_attempt_id: validUuid() })).rejects.toThrow()
    await expect(insert("CONNECTED", { ...active(), refresh_operation_id: validUuid(), refresh_operation_started_at: new Date() })).resolves.toBeUndefined()
    const [saved] = rows(await pgConnection.raw(`select id from ebay_integration_connection where id like 'constraint-%'`))
    await expect(pgConnection.raw(`update ebay_integration_connection set status = 'DISCONNECTED' where id = ?`, [saved.id])).rejects.toThrow()
    await expect(pgConnection.raw(`update ebay_integration_connection set refresh_token_iv = null where id = ?`, [saved.id])).rejects.toThrow()
  })

  it("uses PostgreSQL time for deterministic stale reservation takeover and rejects displaced owners", async () => {
    const attempt = await begin("SANDBOX")
    const connection = await complete(attempt, "reservation-token")
    const firstOperation = randomUUID()
    const first = await service.prepareCredentialRefresh({ connectionId: connection.id, operationId: firstOperation })
    await expect(service.prepareCredentialRefresh({ connectionId: connection.id, operationId: randomUUID() })).rejects.toThrow(/already refreshing|unavailable/)
    await pgConnection.raw(
      `update ebay_integration_connection set refresh_operation_started_at = now() - interval '61 seconds' where id = ?`, [connection.id]
    )
    const secondOperation = randomUUID()
    const second = await service.prepareCredentialRefresh({ connectionId: connection.id, operationId: secondOperation })
    expect(second.credentialGeneration).toBe(first.credentialGeneration)
    await expect(service.recordRefreshSuccess({ connectionId: connection.id, expectedGeneration: first.credentialGeneration,
      operationId: firstOperation, accessTokenExpiresAt: new Date(), correlationId: randomUUID() })).resolves.toBe(false)
    await expect(service.recordRefreshFailure({ connectionId: connection.id, expectedGeneration: first.credentialGeneration,
      operationId: firstOperation, category: "REMOTE_UNAVAILABLE", correlationId: randomUUID() })).resolves.toBe(false)
    await expect(service.recordRefreshSuccess({ connectionId: connection.id, expectedGeneration: second.credentialGeneration,
      operationId: secondOperation, accessTokenExpiresAt: new Date(), correlationId: randomUUID() })).resolves.toBe(true)
  })

  // MedusaApp caches this module instance process-wide: the explicit identity
  // assertion below proves two in-process apps are not an independent-module
  // boundary. Keep the attempted harness as evidence; deployment validation
  // requires two Node processes (or isolated workers) against the same test DB.
  it.skip("coordinates independent service, cache, lock-provider, and database-connection objects through PostgreSQL", async () => {
    const connectionA = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
    const connectionB = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
    const boot = async (connection: ReturnType<typeof createPgConnection>) => {
      const app = await MedusaApp({
        modulesConfig: {
          [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" },
          [Modules.LOCKING]: { resolve: "@medusajs/medusa/locking", options: { providers: [{
            resolve: "@medusajs/medusa/locking-postgres", id: "locking-postgres", is_default: true,
          }] } },
        },
        injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: connection }, cwd: process.cwd(),
      })
      await app.onApplicationStart()
      return app
    }
    const appA = await boot(connectionA)
    const appB = await boot(connectionB)
    const serviceA = appA.modules[EBAY_INTEGRATION_MODULE] as any
    const serviceB = appB.modules[EBAY_INTEGRATION_MODULE] as any
    const containerA = appA.sharedContainer!
    const containerB = appB.sharedContainer!
    const providerA = containerA.resolve<any>(Modules.LOCKING)
    const providerB = containerB.resolve<any>(Modules.LOCKING)
    try {
      expect(Object.is(serviceA, serviceB)).toBe(false)
      expect(Object.is(providerA, providerB)).toBe(false)
      expect(Object.is(connectionA, connectionB)).toBe(false)
      const attempt = await begin("SANDBOX")
      const connection = await complete(attempt, "independent-boundary-token")
      const operationA = randomUUID()
      const operationB = randomUUID()
      const tokenA = createEbayTokenService({
        resolveConfig: () => ({ environment: "SANDBOX" } as EbayEnvironmentConfig),
        resolveKeyring: () => keyring,
        resolveClient: () => ({ refreshUserAccessToken: async () => ({ token: { access_token: "instance-a", expires_in: 3600, token_type: "User Access Token" }, correlationId: randomUUID() }) } as unknown as EbayOAuthClient),
      })
      const tokenB = createEbayTokenService({
        resolveConfig: () => ({ environment: "SANDBOX" } as EbayEnvironmentConfig),
        resolveKeyring: () => keyring,
        resolveClient: () => ({ refreshUserAccessToken: async () => ({ token: { access_token: "instance-b", expires_in: 3600, token_type: "User Access Token" }, correlationId: randomUUID() }) } as unknown as EbayOAuthClient),
      })
      expect(Object.is(tokenA, tokenB)).toBe(false)
      const first = await serviceA.prepareCredentialRefresh({ connectionId: connection.id, operationId: operationA })
      await expect(serviceB.prepareCredentialRefresh({ connectionId: connection.id, operationId: operationB })).rejects.toThrow()
      const disconnect = await serviceB.beginDisconnect("SANDBOX")
      expect(disconnect.connection?.status).toBe("DISCONNECTING")
      await expect(serviceA.recordRefreshSuccess({ connectionId: connection.id, expectedGeneration: first.credentialGeneration,
        operationId: operationA, accessTokenExpiresAt: new Date(), correlationId: randomUUID() })).resolves.toBe(false)
      await serviceB.completeDisconnect({ environment: "SANDBOX", connectionId: connection.id,
        expectedGeneration: disconnect.credential?.credentialGeneration ?? null, actorId: "independent-test",
        remotelyRevoked: false, correlationId: randomUUID() })
      await expect(serviceA.retrieveStoredCredential(connection.id)).rejects.toThrow("No usable")
      // Exercise each independent provider directly against the shared DB.
      await providerA.execute("independent-provider-proof", async () => undefined)
      await providerB.execute("independent-provider-proof", async () => undefined)
      expect(Object.is(containerA.resolve(Modules.LOCKING), containerB.resolve(Modules.LOCKING))).toBe(false)
    } finally {
      await appA.onApplicationPrepareShutdown()
      await appB.onApplicationPrepareShutdown()
      await appA.onApplicationShutdown()
      await appB.onApplicationShutdown()
      await (connectionA as any).context?.destroy()
      await (connectionB as any).context?.destroy()
      await connectionA.destroy()
      await connectionB.destroy()
    }
  }, 30_000)

  it("allows one retained connection per environment and isolates Sandbox from Production", async () => {
    const sandbox = await begin("SANDBOX")
    const production = await begin("PRODUCTION")
    const rows = await service.listSafeConnections()
    expect(rows.filter((row: any) => row.environment === "SANDBOX")).toHaveLength(1)
    expect(rows.filter((row: any) => row.environment === "PRODUCTION")).toHaveLength(1)
    expect(await service.consumeOAuthState({
      stateHash: hashOAuthState(sandbox.state), environment: "SANDBOX",
    })).toMatchObject({ attemptId: sandbox.attemptId, current: true })
    expect(await service.consumeOAuthState({
      stateHash: hashOAuthState(production.state), environment: "PRODUCTION",
    })).toMatchObject({ attemptId: production.attemptId, current: true })
  })

  it("atomically consumes one state once and derives its actor and attempt", async () => {
    const attempt = await begin("SANDBOX")
    const input = { stateHash: hashOAuthState(attempt.state), environment: "SANDBOX" }
    const results = await Promise.allSettled([service.consumeOAuthState(input), service.consumeOAuthState(input)])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const fulfilled = results.find((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")!
    expect(fulfilled.value).toMatchObject({ actorId: attempt.actorId, attemptId: attempt.attemptId, current: true })
  })

  it("rejects the wrong environment and expired state safely", async () => {
    const attempt = await begin("SANDBOX")
    await expect(service.consumeOAuthState({
      stateHash: hashOAuthState(attempt.state), environment: "PRODUCTION",
    })).rejects.toThrow("invalid or has expired")
    const expired = await begin("SANDBOX", `expired-${suffix()}`, new Date(Date.now() - 1_000))
    await expect(service.consumeOAuthState({
      stateHash: hashOAuthState(expired.state), environment: "SANDBOX",
    })).rejects.toThrow("invalid or has expired")
  })

  it("only permits the latest actor attempt to complete or fail", async () => {
    const older = await begin("SANDBOX", `older-${suffix()}`)
    const newer = await begin("SANDBOX", `newer-${suffix()}`)
    await expect(service.consumeOAuthState({
      stateHash: hashOAuthState(older.state), environment: "SANDBOX",
    })).rejects.toThrow("invalid or has expired")
    const connected = await complete(newer, "newer-token")
    expect(connected.status).toBe("CONNECTED")
    expect(await service.recordConnectionFailure({
      environment: "SANDBOX", actorId: older.actorId, attemptId: older.attemptId,
      category: "OAUTH_REJECTED", correlationId: randomUUID(),
    })).toBe(false)
    expect((await service.retrieveSafeConnectionByEnvironment("SANDBOX")).status).toBe("CONNECTED")
  })

  it("cannot let an already-consumed callback overwrite a newer successful attempt", async () => {
    const older = await begin("SANDBOX", `older-consumed-${suffix()}`)
    expect(await service.consumeOAuthState({
      stateHash: hashOAuthState(older.state), environment: "SANDBOX",
    })).toMatchObject({ actorId: older.actorId, attemptId: older.attemptId, current: true })

    const newer = await begin("SANDBOX", `newer-winner-${suffix()}`)
    const winner = await complete(newer, "winner-token")
    expect(await service.completeConnection({
      environment: "SANDBOX", actorId: older.actorId, attemptId: older.attemptId,
      accountId: "losing-account", displayName: "Losing seller",
      encryptedToken: encryptRefreshToken("losing-token", keyring), grantedScopes: ["identity"],
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000), correlationId: randomUUID(),
    })).toBeNull()
    expect(await service.recordConnectionFailure({
      environment: "SANDBOX", actorId: older.actorId, attemptId: older.attemptId,
      category: "INTERNAL", correlationId: randomUUID(),
    })).toBe(false)

    const stored = await service.retrieveStoredCredential(winner.id)
    expect(stored).toMatchObject({
      status: "CONNECTED", credentialGeneration: newer.attemptId,
    })
    const safe = await service.retrieveSafeConnectionByEnvironment("SANDBOX")
    expect(safe).toMatchObject({ ebayAccountId: winner.ebayAccountId })
    expect(safe).not.toHaveProperty("connectedBy")
  })

  it("never returns encrypted fields and preserves audit after disconnect", async () => {
    const attempt = await begin("SANDBOX")
    const connection = await complete(attempt)
    expect(JSON.stringify(connection)).not.toMatch(/refresh_token|ciphertext|authTag/)
    const auditsBefore = await service.listEbayConnectionAudits({ connection_id: connection.id })
    const prepared = await service.beginDisconnect("SANDBOX")
    await service.completeDisconnect({
      environment: "SANDBOX", connectionId: connection.id,
      expectedGeneration: prepared.credential.credentialGeneration,
      actorId: attempt.actorId, remotelyRevoked: true, correlationId: randomUUID(),
    })
    expect((await service.listEbayConnectionAudits({ connection_id: connection.id })).length).toBeGreaterThan(auditsBefore.length)
    await expect(service.retrieveStoredCredential(connection.id)).rejects.toThrow("No usable")
  })

  it("keeps connection, state, and audit mutations domain-owned", async () => {
    await expect(service.createEbayConnections()).rejects.toThrow("domain-owned")
    await expect(service.createEbayOAuthStates()).rejects.toThrow("domain-owned")
    await expect(service.updateEbayOAuthStates()).rejects.toThrow("domain-owned")
    await expect(service.deleteEbayOAuthStates()).rejects.toThrow("domain-owned")
    await expect(service.createEbayConnectionAudits()).rejects.toThrow("domain-owned")
    await expect(service.updateEbayConnectionAudits()).rejects.toThrow("domain-owned")
    await expect(service.deleteEbayConnectionAudits()).rejects.toThrow("domain-owned")
  })

  it("replaces token material only for the expected credential generation", async () => {
    const attempt = await begin("PRODUCTION")
    const connection = await complete(attempt, "first-token")
    const replacement = encryptRefreshToken("replacement-token", keyring)
    const operationId = randomUUID()
    await service.prepareCredentialRefresh({ connectionId: connection.id, operationId })
    expect(await service.recordRefreshSuccess({
      connectionId: connection.id, expectedGeneration: attempt.attemptId, operationId, replacementToken: replacement,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000), correlationId: randomUUID(),
    })).toBe(true)
    expect((await service.retrieveStoredCredential(connection.id)).ciphertext).toBe(replacement.ciphertext)
  })

  it("retains credentials and uses DEGRADED for a retryable refresh failure", async () => {
    const attempt = await begin("PRODUCTION")
    const connection = await complete(attempt, "preserved-token")
    const before = await service.retrieveStoredCredential(connection.id)
    const operationId = randomUUID()
    await service.prepareCredentialRefresh({ connectionId: connection.id, operationId })
    expect(await service.recordRefreshFailure({
      connectionId: connection.id, expectedGeneration: attempt.attemptId, operationId,
      category: "REMOTE_UNAVAILABLE", correlationId: randomUUID(),
    })).toBe(true)
    const stored = await service.retrieveStoredCredential(connection.id)
    expect(stored.ciphertext).toBe(before.ciphertext)
    expect(stored.status).toBe("DEGRADED")
  })

  it("retains encrypted material but requires renewed consent for an invalid grant", async () => {
    const attempt = await begin("SANDBOX")
    const connection = await complete(attempt, "expired-provider-grant")
    const before = await service.retrieveStoredCredential(connection.id)
    const operationId = randomUUID()
    await service.prepareCredentialRefresh({ connectionId: connection.id, operationId })
    expect(await service.recordRefreshFailure({
      connectionId: connection.id, expectedGeneration: attempt.attemptId, operationId,
      category: "REFRESH_REQUIRED", correlationId: randomUUID(),
    })).toBe(true)
    const stored = await service.retrieveStoredCredential(connection.id)
    expect(stored).toMatchObject({ status: "REFRESH_REQUIRED", ciphertext: before.ciphertext })
  })

  it("prevents an old generation from rotating over a newer connection", async () => {
    const first = await begin("PRODUCTION")
    const connection = await complete(first, "first")
    const second = await begin("PRODUCTION")
    await complete(second, "second")
    const staleOperationId = randomUUID()
    expect(await service.recordRefreshSuccess({
      connectionId: connection.id, expectedGeneration: first.attemptId,
      operationId: staleOperationId,
      replacementToken: encryptRefreshToken("stale", keyring),
      accessTokenExpiresAt: new Date(), correlationId: randomUUID(),
    })).toBe(false)
    expect((await service.retrieveStoredCredential(connection.id)).credentialGeneration).toBe(second.attemptId)
  })

  it("coordinates two independent token-service caches through PostgreSQL lifecycle locking and reservation", async () => {
    const attempt = await begin("SANDBOX")
    const connection = await complete(attempt, "shared-database-token")
    let releaseRefresh!: () => void
    let markStarted!: () => void
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve })
    const refreshStarted = new Promise<void>((resolve) => { markStarted = resolve })
    const config = { environment: "SANDBOX" } as EbayEnvironmentConfig
    const client = {
      refreshUserAccessToken: async () => {
        markStarted()
        await refreshGate
        return { token: { access_token: "cross-cache-token", expires_in: 3600, token_type: "User Access Token" }, correlationId: randomUUID() }
      },
    } as unknown as EbayOAuthClient
    const dependencies = {
      resolveConfig: () => config, resolveClient: () => client, resolveKeyring: () => keyring,
    }
    const first = createEbayTokenService(dependencies)
    const second = createEbayTokenService(dependencies)
    const container = medusaApp.sharedContainer!

    const winningRefresh = first.getAccessToken(container, connection.id)
    await refreshStarted
    await expect(second.getAccessToken(container, connection.id)).rejects.toThrow("already refreshing")
    releaseRefresh()
    await expect(winningRefresh).resolves.toBe("cross-cache-token")
  })

  it("cleans only old consumed or expired states within the requested bound", async () => {
    const current = await begin("SANDBOX")
    const old = await begin("PRODUCTION", `old-${suffix()}`, new Date(Date.now() - 25 * 3_600_000))
    await pgConnection.raw(
      `update ebay_integration_oauth_state set consumed_at = now() - interval '25 hours', expires_at = now() - interval '25 hours'
       where attempt_id = ?`, [old.attemptId]
    )
    expect(await service.cleanupOAuthStates(1)).toBe(1)
    const [active] = rows(await pgConnection.raw(
      `select id from ebay_integration_oauth_state where attempt_id = ?`, [current.attemptId]
    ))
    expect(active).toBeTruthy()
  })
})
