import { randomUUID } from "node:crypto"
import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection, MedusaError, Modules } from "@medusajs/framework/utils"
import { assertTestDatabase } from "../../../utils/assert-test-database"
import { EBAY_INTEGRATION_MODULE } from "../index"
import { CONTROL_MARKER, ensureControlTable, signal, waitForMarker } from "./cross-process-control"
import { observedServiceInstanceId } from "./service-instance-identity"
import { classifyWorkerError } from "./store-category-cross-process-outcome"

type TestLockManager = { execute<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> }
type TestLockObserverService = { __setTestLockObserver?: (observer: ((manager: TestLockManager) => Promise<void>) | undefined) => Promise<void> }

const runId = process.env.EBAY_E2A1_TEST_RUN_ID ?? ""
const role = process.env.EBAY_E2A1_WORKER_ROLE ?? ""
const scenario = process.env.EBAY_E2A1_SCENARIO ?? "COMPETING_IMPORTS"
const unrelatedExternalId = process.env.EBAY_E2A1_UNRELATED_EXTERNAL_ID ?? ""
const worker = /^[a-f0-9-]{36}$/.test(runId) && (role === "A" || role === "B" || role === "MUTATE" || role === "IMPORT")
const externalIds = { root: `e2a1-${runId}-root`, childA: `e2a1-${runId}-child-a`, childB: `e2a1-${runId}-child-b` }
type PreservedCategory = { externalId: string; name: string; parentExternalId: string | null; siblingOrder: number }
let preservedCategories: PreservedCategory[] = []
const csvField = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
const snapshot = (child: "A" | "B") => [
  "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
  ...preservedCategories.map((category) => [category.externalId, category.name, category.parentExternalId ?? "", String(category.siblingOrder)].map(csvField).join(",")),
  `${externalIds.root},Run ${runId} root,,10`,
  child === "A"
    ? `${externalIds.childA},Run ${runId} child A,${externalIds.root},10`
    : `${externalIds.childB},Run ${runId} child B,${externalIds.root},20`,
  `${unrelatedExternalId},Run ${runId} unrelated,,99`,
].join("\n")
const actorId = `e2a1-${runId}-${role}`
const correlationId = () => `${runId}:${role}:${randomUUID()}`.slice(0, 128)

function safeFailure(error: unknown): string {
  const category = error instanceof MedusaError ? "MEDUSA_ERROR" : error instanceof Error ? "ERROR" : "NON_ERROR_THROWN"
  const candidate = error instanceof MedusaError ? String(error.type) : error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "UNEXPECTED"
  const code = /^[A-Z0-9_-]{1,40}$/i.test(candidate) ? candidate : "UNEXPECTED"
  return JSON.stringify({ category, code })
}

describe("E2A1 isolated Store-category CSV worker", () => {
  if (!worker) { it.skip("runs only when targeted by the cross-process parent", () => undefined); return }
  let pg: ReturnType<typeof createPgConnection>; let app: Awaited<ReturnType<typeof MedusaApp>>; let service: any
  let observedBackendPid: number | undefined
  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL, { requireDatabase: true })
    pg = createPgConnection({ clientUrl: process.env.DATABASE_URL as string }); await ensureControlTable(pg)
    app = await MedusaApp({ modulesConfig: { [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" }, [Modules.LOCKING]: { resolve: "@medusajs/medusa/locking", options: { providers: [{ resolve: "@medusajs/medusa/locking-postgres", id: "locking-postgres", is_default: true }] } } }, injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pg }, cwd: process.cwd() })
    await app.onApplicationStart(); service = app.modules[EBAY_INTEGRATION_MODULE]
    const ctor = service.constructor as TestLockObserverService
    await ctor.__setTestLockObserver?.(async (manager) => {
      const [row] = await manager.execute<{ pid: number }>("select pg_backend_pid() as pid")
      observedBackendPid = Number(row.pid)
    })
    const current = await service.listStoreCategories("SANDBOX")
    preservedCategories = current.categories.filter((category: { externalId: string; status: string }) => category.status === "ACTIVE" && category.externalId !== unrelatedExternalId && !Object.values(externalIds).includes(category.externalId)).map((category: PreservedCategory) => ({ externalId: category.externalId, name: category.name, parentExternalId: category.parentExternalId, siblingOrder: category.siblingOrder }))
    await signal(pg, runId, role, CONTROL_MARKER.INSTANCE, JSON.stringify({ pid: process.pid, service: observedServiceInstanceId(service) }))
  }, 60_000)
  afterAll(async () => {
    const ctor = service?.constructor as TestLockObserverService | undefined
    await ctor?.__setTestLockObserver?.(undefined)
    if (app) { await app.onApplicationPrepareShutdown(); await app.onApplicationShutdown() }; await (pg as any)?.context?.destroy?.(); await pg?.destroy()
  })
  it("runs its isolated catalogue operation after the parent barrier", async () => {
    let mutationTargetExternalId: string | undefined
    await signal(pg, runId, role, role === "A" || role === "MUTATE" ? CONTROL_MARKER.READY_A : CONTROL_MARKER.READY_B)
    await waitForMarker(pg, runId, CONTROL_MARKER.RELEASE_START, ["PARENT"])
    try {
      if (scenario === "FORCE_UNEXPECTED_FAILURE") throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "forced worker failure")
      if (scenario === "MUTATION_VS_IMPORT" && role === "MUTATE") {
        const current = await service.listStoreCategories("SANDBOX")
        const target = current.categories.find((category: { externalId: string; status: string }) => category.externalId === externalIds.childA && category.status === "ACTIVE")
        if (!target) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Scenario B fixture is unavailable.")
        mutationTargetExternalId = target.externalId
        await service.updateStoreCategory({ environment: "SANDBOX", id: target.id, name: `Mutation ${runId}`, parentExternalId: externalIds.root, siblingOrder: 30, actorId, correlationId: correlationId() })
      } else {
        const csv = snapshot(role === "A" ? "A" : "B")
        const preview = await service.previewStoreCategoryCsv({ environment: "SANDBOX", csv, actorId, correlationId: correlationId() })
        await service.applyStoreCategoryCsv({ previewId: preview.previewId, csv, actorId, correlationId: correlationId() })
      }
      if (observedBackendPid !== undefined) await signal(pg, runId, role, CONTROL_MARKER.CONNECTION, JSON.stringify({ pid: observedBackendPid }))
      await signal(pg, runId, role, CONTROL_MARKER.OUTCOME, "SUCCESS")
      await signal(pg, runId, role, CONTROL_MARKER.WORKER_COMPLETE)
    } catch (error) {
      const classification = classifyWorkerError(error, {
        scenario,
        role,
        runId,
        mutationTargetExternalId,
      })
      if (classification.outcome === "VALIDATION_REJECTED") {
        if (observedBackendPid !== undefined) await signal(pg, runId, role, CONTROL_MARKER.CONNECTION, JSON.stringify({ pid: observedBackendPid }))
        if (classification.safeFailureCategory) await signal(pg, runId, role, CONTROL_MARKER.SAFE_FAILURE_CATEGORY, classification.safeFailureCategory)
        await signal(pg, runId, role, CONTROL_MARKER.OUTCOME, "VALIDATION_REJECTED")
        await signal(pg, runId, role, CONTROL_MARKER.WORKER_COMPLETE)
        return
      }
      await signal(pg, runId, role, CONTROL_MARKER.OUTCOME, "UNEXPECTED_FAILURE")
      await signal(pg, runId, role, CONTROL_MARKER.UNEXPECTED_FAILURE, safeFailure(error))
      await signal(pg, runId, role, CONTROL_MARKER.WORKER_COMPLETE)
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The isolated worker failed unexpectedly.")
    }
  }, 45_000)
})
