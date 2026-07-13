import { z, type ZodType, type infer as ZodInfer } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Small, shared zod building blocks for the newsletter module's narrowly
 * scoped configuration readers (rate limiting, reCAPTCHA). This is not the
 * repo-wide environment schema — that lands in Stage 2C.8 — it only exists
 * so the rate-limit and reCAPTCHA config readers don't each hand-roll the
 * same "required, bounded, numeric-string" parsing.
 */

export type EnvSource = Record<string, string | undefined>

export function requiredTrimmedString(name: string) {
  return z
    .string({ error: `${name} is required and was not set` })
    .trim()
    .min(1, `${name} is required and was not set`)
}

export function boundedIntegerString(
  name: string,
  bounds: { min: number; max: number }
) {
  return requiredTrimmedString(name)
    .regex(/^-?\d+$/, `${name} must be a finite integer, without a decimal point`)
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value), `${name} must be a finite integer`)
    .refine(
      (value) => value >= bounds.min && value <= bounds.max,
      `${name} must be an integer between ${bounds.min} and ${bounds.max}`
    )
}

export function boundedNumberString(
  name: string,
  bounds: { min: number; max: number }
) {
  return requiredTrimmedString(name)
    .regex(/^-?\d+(\.\d+)?$/, `${name} must be a finite number`)
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value), `${name} must be a finite number`)
    .refine(
      (value) => value >= bounds.min && value <= bounds.max,
      `${name} must be a number between ${bounds.min} and ${bounds.max}`
    )
}

/**
 * Parses `value` against `schema`, converting any zod failure into a
 * `MedusaError` so every newsletter config reader fails the same way
 * (throws) regardless of environment — this is what makes "missing or
 * invalid required configuration" fail closed: callers that do not resolve
 * configuration successfully can never reach an "allowed" code path.
 */
export function parseEnvSchema<T extends ZodType>(
  schema: T,
  value: unknown
): ZodInfer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const message = result.error.issues
      .map((issue: { message: string }) => issue.message)
      .join("; ")
    throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
  }
  return result.data
}
