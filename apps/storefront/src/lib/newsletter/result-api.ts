export type ConfirmationResult =
  | "confirmed"
  | "already_confirmed"
  | "invalid_or_expired"
  | "temporary_error"

export type UnsubscribeResult =
  | "unsubscribed"
  | "already_unsubscribed"
  | "invalid"
  | "temporary_error"

type TokenResultKind = "confirm" | "unsubscribe"

const allowedResults = {
  confirm: new Set(["confirmed", "already_confirmed", "invalid_or_expired"]),
  unsubscribe: new Set(["unsubscribed", "already_unsubscribed", "invalid"]),
} as const

async function requestTokenResult(
  kind: TokenResultKind,
  token: string | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  if (!token) {
    return kind === "confirm" ? "invalid_or_expired" : "invalid"
  }
  if (!baseUrl || !publishableKey) return "temporary_error"

  try {
    const url = new URL(`/store/newsletter/${kind}`, baseUrl)
    url.searchParams.set("token", token)
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-publishable-api-key": publishableKey,
      },
      cache: "no-store",
    })

    if (response.status !== 200 && response.status !== 400) {
      return "temporary_error"
    }

    const body: unknown = await response.json()
    const result =
      typeof body === "object" && body !== null && "result" in body
        ? (body as { result?: unknown }).result
        : undefined

    return typeof result === "string" &&
      allowedResults[kind].has(result as never)
      ? result
      : "temporary_error"
  } catch {
    return "temporary_error"
  }
}

export async function getConfirmationResult(
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ConfirmationResult> {
  return (await requestTokenResult(
    "confirm",
    token,
    fetchImpl,
  )) as ConfirmationResult
}

export async function getUnsubscribeResult(
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<UnsubscribeResult> {
  return (await requestTokenResult(
    "unsubscribe",
    token,
    fetchImpl,
  )) as UnsubscribeResult
}
