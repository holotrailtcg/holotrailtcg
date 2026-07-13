import { MedusaError } from "@medusajs/framework/utils"

/**
 * A conservative, ISO 3166-1 alpha-2-shaped country-code validator — two
 * lower-case letters, matching the `[countryCode]` segment convention the
 * storefront's own routing/middleware already uses. This deliberately does
 * not hard-code or import the storefront's live region list (that would be
 * unrelated internationalisation architecture for this stage); it only
 * enforces the shape every currently supported code (starting with `gb`)
 * already has, so an arbitrary/unvalidated value can never reach the URL.
 */
const COUNTRY_CODE_PATTERN = /^[a-z]{2}$/

export function isSupportedCountryCode(countryCode: string): boolean {
  return typeof countryCode === "string" && COUNTRY_CODE_PATTERN.test(countryCode)
}

export interface BuildConfirmationUrlInput {
  /** Already-validated bare origin from `resolveResendConfig` (no path/query/fragment). */
  storefrontBaseUrl: string
  countryCode: string
  /** The opaque plaintext confirmation token — never the subscriber id, email or token hash. */
  confirmationToken: string
}

/**
 * Builds the country-aware confirmation URL:
 * `{storefrontBaseUrl}/{countryCode}/newsletter/confirm?token={token}`.
 *
 * Never includes the subscriber id, email, first name or token hash — only
 * the opaque confirmation token, exactly as received from the subscriber
 * lifecycle. `new URL(path, base)` is used so a trailing slash on
 * `storefrontBaseUrl` cannot produce a malformed `//` in the result.
 */
export function buildConfirmationUrl(input: BuildConfirmationUrlInput): string {
  if (!isSupportedCountryCode(input.countryCode)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unsupported country code for a confirmation URL: "${input.countryCode}"`
    )
  }

  if (
    typeof input.confirmationToken !== "string" ||
    input.confirmationToken.trim().length === 0
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "confirmationToken must be a non-empty string"
    )
  }

  let base: URL
  try {
    base = new URL(input.storefrontBaseUrl)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "storefrontBaseUrl must be an absolute URL"
    )
  }

  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "storefrontBaseUrl must use the http or https scheme"
    )
  }

  const url = new URL(`/${input.countryCode}/newsletter/confirm`, base)
  url.search = ""
  url.hash = ""
  url.searchParams.set("token", input.confirmationToken)
  return url.toString()
}
