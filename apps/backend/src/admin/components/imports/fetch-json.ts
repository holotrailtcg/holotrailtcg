export async function fetchJson<T>(url: string): Promise<T> {
  const result = await fetch(url, { credentials: "include" })
  if (!result.ok) {
    throw new Error("Request failed")
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
    throw new Error("Request failed")
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
    throw new Error("Request failed")
  }
  return result.json()
}
