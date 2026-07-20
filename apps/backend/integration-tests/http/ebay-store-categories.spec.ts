import { ContainerRegistrationKeys, generateJwtToken, MedusaError } from "@medusajs/framework/utils"
import { EBAY_INTEGRATION_MODULE } from "../../src/modules/ebay-integration"
import type EbayIntegrationModuleService from "../../src/modules/ebay-integration/service"
import { bootstrapNewsletterHttpTestApp, type NewsletterHttpTestApp } from "./support/bootstrap"

jest.setTimeout(180_000)

const origin = "http://localhost:9000"
const csv = "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\n24393782015,Black Star Promo Cards,,10\n24393788015,Mega Evolution Promos,24393782015,10\n"
let app: NewsletterHttpTestApp
let token: string

const headers = (includeOrigin = true, value = token) => ({ "Content-Type": "application/json", authorization: `Bearer ${value}`, ...(includeOrigin ? { origin } : {}) })
const post = (path: string, body: unknown, includeOrigin = true, value = token) => fetch(`${app.baseUrl}${path}`, { method: "POST", headers: headers(includeOrigin, value), body: JSON.stringify(body) })
const list = (environment = "SANDBOX", value = token) => fetch(`${app.baseUrl}/admin/ebay/store-categories?environment=${environment}`, { headers: { authorization: `Bearer ${value}` } })
const audits = (environment = "SANDBOX", value = token) => fetch(`${app.baseUrl}/admin/ebay/store-categories/audit?environment=${environment}&limit=100`, { headers: { authorization: `Bearer ${value}` } })

async function connect(environment: "SANDBOX" | "PRODUCTION") {
  const start = await post("/admin/ebay/connections", { environment, reconnect: true, confirmProduction: environment === "PRODUCTION" })
  expect(start.status).toBe(201)
  const state = new URL((await start.json() as { authorisationUrl: string }).authorisationUrl).searchParams.get("state")!
  const callback = await fetch(`${app.baseUrl}/admin/ebay/connections/callback/${environment}?state=${encodeURIComponent(state)}&code=http-store-category-${environment}`, { redirect: "manual" })
  expect(callback.headers.get("location")).toContain("result=connected")
}

beforeAll(async () => {
  if (!process.env.JWT_SECRET) throw new MedusaError(MedusaError.Types.INVALID_DATA, "JWT_SECRET is required for HTTP integration tests")
  app = await bootstrapNewsletterHttpTestApp()
  token = generateJwtToken({ actor_id: "user_e2a1_http_actor", actor_type: "user", auth_identity_id: "auth_e2a1_http" }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })
  const pg = app.container.resolve<any>(ContainerRegistrationKeys.PG_CONNECTION)
  // This persistent, clearly named test database is shared by focused HTTP
  // runs. Remove only the local catalogue rows for the fake test account so
  // this spec remains repeatable without touching development data.
  await pg.raw("delete from ebay_integration_store_category_audit where ebay_account_id = ?", ["http-test-ebay-account"])
  await pg.raw("delete from ebay_integration_store_category where ebay_account_id = ?", ["http-test-ebay-account"])
  await connect("SANDBOX")
  await connect("PRODUCTION")
})

afterAll(async () => { await app.close() })

describe("E2A1 Admin Store category routes", () => {
  it("requires Admin authentication and reads only the requested environment scope", async () => {
    expect((await fetch(`${app.baseUrl}/admin/ebay/store-categories?environment=SANDBOX`)).status).toBe(401)
    expect((await list()).status).toBe(200)
    const production = await list("PRODUCTION")
    expect(production.status).toBe(200)
    expect((await production.json() as { categories: unknown[] }).categories).toEqual([])
  })

  it("creates, edits, and locally removes with actor identity supplied only by authentication", async () => {
    const created = await post("/admin/ebay/store-categories", { environment: "SANDBOX", externalId: "24393782015", name: "Black Star Promo Cards", parentExternalId: null, siblingOrder: 10, actorId: "spoofed" })
    expect(created.status).toBe(400)
    const valid = await post("/admin/ebay/store-categories", { environment: "SANDBOX", externalId: "24393782015", name: "Black Star Promo Cards", parentExternalId: null, siblingOrder: 10 })
    expect(valid.status).toBe(201)
    const category = (await valid.json() as { category: { id: string; externalId: string } }).category
    expect(category.externalId).toBe("24393782015")
    const edited = await post(`/admin/ebay/store-categories/${category.id}`, { environment: "SANDBOX", name: "Edited locally", parentExternalId: null, siblingOrder: 11 })
    expect(edited.status).toBe(200)
    expect((await post(`/admin/ebay/store-categories/${category.id}/remove`, { environment: "SANDBOX", reason: "", confirm: true })).status).toBe(400)
    expect((await post(`/admin/ebay/store-categories/${category.id}/remove`, { environment: "SANDBOX", reason: "valid", confirm: false })).status).toBe(400)
    expect((await post(`/admin/ebay/store-categories/${category.id}/remove`, { environment: "SANDBOX", reason: "Local cleanup", confirm: true })).status).toBe(200)
    const pg = app.container.resolve<any>(ContainerRegistrationKeys.PG_CONNECTION)
    const audit = (await pg.raw("select actor_id from ebay_integration_store_category_audit where category_id = ? order by created_at desc limit 1", [category.id])).rows[0]
    expect(audit.actor_id).toBe("user_e2a1_http_actor")
  })

  it("enforces Origin and strict mutation schemas without exposing raw input", async () => {
    const rawCsv = "raw-csv-sentinel"
    const noOrigin = await post("/admin/ebay/store-categories/preview", { environment: "SANDBOX", csv: rawCsv }, false)
    expect(noOrigin.status).toBe(400)
    const extra = await post("/admin/ebay/store-categories/preview", { environment: "SANDBOX", csv: rawCsv, unexpected: true })
    expect(extra.status).toBe(400)
    expect(await extra.text()).not.toContain(rawCsv)
  })

  it("previews without mutation, requires import confirmation, and keeps a failed import atomic", async () => {
    const before = await list(); const beforeBody = await before.json() as { categories: Array<{ externalId: string; status: string }> }
    const preview = await post("/admin/ebay/store-categories/preview", { environment: "SANDBOX", csv })
    expect(preview.status).toBe(200)
    const previewBody = (await preview.json() as { preview: { previewId: string; added: string[] } }).preview
    expect(previewBody.added).toContain("24393788015")
    expect(await (await list()).json()).toEqual(beforeBody)
    expect((await post("/admin/ebay/store-categories/import", { previewId: previewBody.previewId, csv })).status).toBe(400)
    const invalid = "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\nnot-valid,broken,,bad"
    const failed = await post("/admin/ebay/store-categories/import", { previewId: previewBody.previewId, csv: invalid, confirm: true })
    expect(failed.status).toBe(400)
    expect(await failed.text()).not.toContain("not-valid")
    expect(await (await list()).json()).toEqual(beforeBody)
    const applied = await post("/admin/ebay/store-categories/import", { previewId: previewBody.previewId, csv, confirm: true })
    expect(applied.status).toBe(200)
    const body = await applied.json() as { accountId: string; categories: Array<{ externalId: string }> }
    expect(body.categories.map((item) => item.externalId)).toEqual(expect.arrayContaining(["24393782015", "24393788015"]))
    expect(JSON.stringify(body)).not.toMatch(/token|secret|ciphertext|raw-csv/i)
    expect((await post("/admin/ebay/store-categories/import", { previewId: previewBody.previewId, csv, confirm: true })).status).toBe(400)
  })

  it("rejects mismatched, cross-environment, cross-actor, expired, and stale previews without mutation", async () => {
    const snapshot = async () => (await (await list()).json() as { categories: unknown[] }).categories
    const preview = async () => (await (await post("/admin/ebay/store-categories/preview", { environment: "SANDBOX", csv })).json() as { preview: { previewId: string } }).preview.previewId
    const before = await snapshot()
    const mismatchedId = await preview()
    expect((await post("/admin/ebay/store-categories/import", { previewId: mismatchedId, csv: `${csv}\n`, confirm: true })).status).toBe(400)
    expect(await snapshot()).toEqual(before)

    const environmentId = await preview()
    expect((await post("/admin/ebay/store-categories/import", { previewId: environmentId, environment: "PRODUCTION", csv, confirm: true })).status).toBe(400)
    expect(await snapshot()).toEqual(before)

    const otherToken = generateJwtToken({ actor_id: "user_e2a1_other_actor", actor_type: "user", auth_identity_id: "auth_e2a1_other" }, { secret: process.env.JWT_SECRET as string, expiresIn: 3600 })
    const actorId = await preview()
    expect((await post("/admin/ebay/store-categories/import", { previewId: actorId, csv, confirm: true }, true, otherToken)).status).toBe(400)
    expect(await snapshot()).toEqual(before)

    const expiredId = await preview()
    const pg = app.container.resolve<any>(ContainerRegistrationKeys.PG_CONNECTION)
    await pg.raw("update ebay_integration_store_category_import_preview set expires_at=now() - interval '1 second' where id=?", [expiredId])
    expect((await post("/admin/ebay/store-categories/import", { previewId: expiredId, csv, confirm: true })).status).toBe(400)
    expect(await snapshot()).toEqual(before)

    const staleId = await preview()
    await post("/admin/ebay/store-categories", { environment: "SANDBOX", externalId: "http-stale-category", name: "Catalogue changed", parentExternalId: null, siblingOrder: 99 })
    const changed = await snapshot()
    expect((await post("/admin/ebay/store-categories/import", { previewId: staleId, csv, confirm: true })).status).toBe(400)
    expect(await snapshot()).toEqual(changed)
  })

  it("rejects omitted snapshot parents and removes only graph descendants", async () => {
    const parentResponse = await post("/admin/ebay/store-categories", { environment: "SANDBOX", externalId: "http-complete-parent", name: "HTTP parent", parentExternalId: null, siblingOrder: 1 })
    expect(parentResponse.status).toBe(201)
    const omittedParentCsv = "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\nhttp-complete-child,Child,http-complete-parent,1\n"
    const invalidPreviewResponse = await post("/admin/ebay/store-categories/preview", { environment: "SANDBOX", csv: omittedParentCsv })
    const invalidPreview = (await invalidPreviewResponse.json() as { preview: { previewId: string; valid: boolean } }).preview
    expect(invalidPreview.valid).toBe(false)
    expect((await post("/admin/ebay/store-categories/import", { previewId: invalidPreview.previewId, csv: omittedParentCsv, confirm: true })).status).toBe(400)
    expect((await (await list()).json() as { categories: Array<{ externalId: string; status: string }> }).categories.find((category) => category.externalId === "http-complete-parent")?.status).toBe("ACTIVE")

    const rootResponse = await post("/admin/ebay/store-categories", { environment: "SANDBOX", externalId: "http-graph-root", name: "HTTP graph", parentExternalId: null, siblingOrder: 2 })
    const root = (await rootResponse.json() as { category: { id: string } }).category
    await post("/admin/ebay/store-categories", { environment: "SANDBOX", externalId: "http-graph-child", name: "Child", parentExternalId: "http-graph-root", siblingOrder: 1 })
    await post("/admin/ebay/store-categories", { environment: "SANDBOX", externalId: "http-graph-lookalike", name: "HTTP graph / unrelated", parentExternalId: null, siblingOrder: 3 })
    expect((await post(`/admin/ebay/store-categories/${root.id}/remove`, { environment: "SANDBOX", reason: "Graph test", confirm: true })).status).toBe(200)
    const categories = (await (await list()).json() as { categories: Array<{ externalId: string; status: string }> }).categories
    expect(categories.find((category) => category.externalId === "http-graph-child")?.status).toBe("REMOVED")
    expect(categories.find((category) => category.externalId === "http-graph-lookalike")?.status).toBe("ACTIVE")
  })

  it("isolates identical IDs by environment and performs no provider or publication work", async () => {
    const callsBefore = { exchange: app.ebayOAuthClient.exchangeCalls.length, identity: app.ebayOAuthClient.identityCalls.length, refresh: app.ebayOAuthClient.refreshCalls.length, revoke: app.ebayOAuthClient.revokeCalls.length }
    const production = await post("/admin/ebay/store-categories", { environment: "PRODUCTION", externalId: "24393782015", name: "Production category", parentExternalId: null, siblingOrder: 1 })
    expect(production.status).toBe(201)
    expect((await list("PRODUCTION")).status).toBe(200)
    const sandbox = await list("SANDBOX")
    expect((await sandbox.json() as { categories: Array<{ name: string }> }).categories.some((item) => item.name === "Production category")).toBe(false)
    expect(app.ebayOAuthClient.exchangeCalls.length).toBe(callsBefore.exchange)
    expect(app.ebayOAuthClient.identityCalls.length).toBe(callsBefore.identity)
    expect(app.ebayOAuthClient.refreshCalls.length).toBe(callsBefore.refresh)
    expect(app.ebayOAuthClient.revokeCalls.length).toBe(callsBefore.revoke)
  })

  it("serves authenticated read-only account-scoped safe audit history", async () => {
    expect((await fetch(`${app.baseUrl}/admin/ebay/store-categories/audit?environment=SANDBOX`)).status).toBe(401)
    const sandboxResponse = await audits()
    expect(sandboxResponse.status).toBe(200)
    const sandbox = await sandboxResponse.json() as { accountId: string; audits: Array<{ action: string; actorId: string; details: Record<string, any> | null }> }
    expect(sandbox.audits.some((audit) => audit.action === "MANUAL_EDITED" && audit.actorId === "user_e2a1_http_actor")).toBe(true)
    expect(sandbox.audits.some((audit) => audit.details?.before && audit.details?.after)).toBe(true)

    const production = await (await audits("PRODUCTION")).json() as { accountId: string; audits: Array<{ details: unknown }> }
    expect(production.accountId).toBe(sandbox.accountId)
    expect(JSON.stringify(production)).not.toContain("http-graph-root")

    const rawCsv = "raw-csv-audit-sentinel"
    await post("/admin/ebay/store-categories/preview", { environment: "SANDBOX", csv: rawCsv })
    expect(JSON.stringify(await (await audits()).json())).not.toContain(rawCsv)
    const beforeMutationAttempt = (await (await audits()).json() as { audits: unknown[] }).audits.length
    expect([400, 404, 405]).toContain((await post("/admin/ebay/store-categories/audit", { environment: "SANDBOX", action: "DELETE" })).status)
    expect((await (await audits()).json() as { audits: unknown[] }).audits).toHaveLength(beforeMutationAttempt)
    expect((await fetch(`${app.baseUrl}/admin/ebay/store-categories/audit?environment=SANDBOX&unexpected=true`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(400)
  })
})
