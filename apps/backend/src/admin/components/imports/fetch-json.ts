/** Thrown by fetchJson/postAction/patchAction on a non-OK response. `status` lets callers distinguish e.g. a 409 conflict from a generic failure without parsing `message` text. */
export class HttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

async function extractErrorMessage(result: Response): Promise<string> {
  try {
    const body = await result.clone().json()
    if (body && typeof body.message === "string" && body.message.trim()) return body.message
    if (body && typeof body.error === "string" && body.error.trim()) return body.error
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  return "Request failed"
}

export async function fetchJson<T>(url: string): Promise<T> {
  const result = await fetch(url, { credentials: "include" })
  if (!result.ok) {
    throw new HttpError(await extractErrorMessage(result), result.status)
  }
  return result.json()
}

export async function postAction<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const result = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  if (!result.ok) {
    throw new HttpError(await extractErrorMessage(result), result.status)
  }
  return result.json()
}

export async function patchAction<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const result = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  if (!result.ok) {
    throw new HttpError(await extractErrorMessage(result), result.status)
  }
  return result.json()
}
