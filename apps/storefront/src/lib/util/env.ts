type BaseUrlEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "NEXT_PUBLIC_BASE_URL" | "NODE_ENV">
>

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"])

/**
 * Resolves the one canonical storefront origin used by metadata and public
 * machine-readable routes. Development may fall back to local HTTP; production
 * always requires an explicitly configured, public HTTPS origin.
 */
export function resolveBaseURL(env: BaseUrlEnvironment = process.env): string {
  const configured = env.NEXT_PUBLIC_BASE_URL?.trim()
  const isProduction = env.NODE_ENV === "production"

  if (!configured) {
    if (isProduction) {
      throw new Error(
        "NEXT_PUBLIC_BASE_URL must be configured as the public HTTPS storefront origin in production"
      )
    }
    return "http://localhost:8000"
  }

  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch {
    throw new Error("NEXT_PUBLIC_BASE_URL must be a valid absolute HTTP URL")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_BASE_URL must use the http or https scheme")
  }
  if (parsed.username || parsed.password) {
    throw new Error("NEXT_PUBLIC_BASE_URL must not contain credentials")
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL must be a bare origin without a path, query or fragment"
    )
  }

  const isLocal = LOCAL_HOSTNAMES.has(parsed.hostname)
  if (isProduction && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_BASE_URL must use https in production")
  }
  if (isProduction && isLocal) {
    throw new Error("NEXT_PUBLIC_BASE_URL must not use localhost in production")
  }
  if (isProduction && parsed.hostname.endsWith(".vercel.app")) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL must use the real public domain, not a Vercel preview hostname"
    )
  }
  if (!isProduction && parsed.protocol === "http:" && !isLocal) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL may only use http for localhost during development"
    )
  }

  return parsed.origin
}

export const getBaseURL = () => resolveBaseURL()
