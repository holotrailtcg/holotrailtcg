import { MedusaError, type createPgConnection } from "@medusajs/framework/utils"

export const CROSS_PROCESS_TIMEOUT_MS = 30_000
export const CROSS_PROCESS_POLL_MS = 40

type PgConnection = ReturnType<typeof createPgConnection>

export const CONTROL_MARKER = {
  READY_A: "READY_A",
  READY_B: "READY_B",
  RELEASE_START: "RELEASE_START",
  REMOTE_REFRESH_REACHED: "REMOTE_REFRESH_REACHED",
  DISCONNECT_COMPLETE: "DISCONNECT_COMPLETE",
  RECONNECT_COMPLETE: "RECONNECT_COMPLETE",
  RESUME_REFRESH: "RESUME_REFRESH",
  WORKER_COMPLETE: "WORKER_COMPLETE",
  INSTANCE: "INSTANCE",
  CONNECTION: "CONNECTION",
  OUTCOME: "OUTCOME",
  SAFE_FAILURE_CATEGORY: "SAFE_FAILURE_CATEGORY",
  UNEXPECTED_FAILURE: "UNEXPECTED_FAILURE",
} as const

export async function ensureControlTable(pg: PgConnection): Promise<void> {
  await pg.raw(`
    create table if not exists ebay_e1_test_control (
      run_id text not null,
      worker_role text not null,
      marker text not null,
      value text null,
      created_at timestamptz not null default now(),
      primary key (run_id, worker_role, marker)
    )
  `)
}

export async function signal(
  pg: PgConnection,
  runId: string,
  role: string,
  marker: string,
  value: string | null = null
): Promise<void> {
  await pg.raw(
    `insert into ebay_e1_test_control (run_id, worker_role, marker, value)
     values (?, ?, ?, ?)
     on conflict (run_id, worker_role, marker)
     do update set value = excluded.value, created_at = now()`,
    [runId, role, marker, value]
  )
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>
  return (result as { rows?: Array<Record<string, unknown>> })?.rows ?? []
}

export async function readMarkers(pg: PgConnection, runId: string): Promise<Array<Record<string, unknown>>> {
  return rows(await pg.raw(
    `select worker_role, marker, value from ebay_e1_test_control
     where run_id = ? order by worker_role, marker`,
    [runId]
  ))
}

export async function waitForMarker(
  pg: PgConnection,
  runId: string,
  marker: string,
  roles: string[],
  timeoutMs = CROSS_PROCESS_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = rows(await pg.raw(
      `select worker_role from ebay_e1_test_control
       where run_id = ? and marker = ? and worker_role = any(?::text[])`,
      [runId, marker, roles]
    )).map((row) => String(row.worker_role))
    if (roles.every((role) => found.includes(role))) return
    await new Promise<void>((resolve) => setTimeout(resolve, CROSS_PROCESS_POLL_MS))
  }
  const diagnostic = await readMarkers(pg, runId)
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `Timed out waiting for ${marker} from ${roles.join(",")}; safe markers=${JSON.stringify(diagnostic)}`
  )
}

export async function cleanupControlRows(pg: PgConnection, runId: string): Promise<void> {
  await pg.raw(`delete from ebay_e1_test_control where run_id = ?`, [runId])
}
