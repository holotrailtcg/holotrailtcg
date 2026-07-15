import { createHash } from "node:crypto"
import { z } from "@medusajs/framework/zod"
import { RARITY, RARITY_ICON_KEY } from "../types"

const MAX_PROVIDER_IDENTIFIER_LENGTH = 128
const MAX_ACTOR_LENGTH = 128
const MAX_DIAGNOSTIC_LENGTH = 128

export const providerIdentifierSchema = z.string().trim().min(1).max(MAX_PROVIDER_IDENTIFIER_LENGTH).refine(
  (value) => ![...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) && !/[\s\/?#]/u.test(value),
  "Invalid provider identifier"
)

export const actorSchema = z.string().trim().min(1).max(MAX_ACTOR_LENGTH).refine(
  (value) => ![...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f),
  "Invalid actor identity"
)

export const optionalActorSchema = actorSchema.optional()
export const tradingCardIdSchema = providerIdentifierSchema
export const auditContextSchema = z.object({ actor: actorSchema, source: z.enum(["MANUAL", "TCGDEX", "PULSE", "OTHER"]), reason: z.string().max(500).optional().nullable() }).strict()

const raritySchema = z.enum(Object.values(RARITY) as [string, ...string[]])
const iconKeySchema = z.enum(Object.values(RARITY_ICON_KEY) as [string, ...string[]])
const boundedDiagnosticSchema = z.string().trim().min(1).max(MAX_DIAGNOSTIC_LENGTH).refine(
  (value) => ![...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f),
  "Invalid diagnostic value"
)

const providerRarityValueSchema = z.string().max(MAX_DIAGNOSTIC_LENGTH).refine(
  (value) => value.trim().length > 0,
  "Provider rarity must not be empty"
).refine(
  (value) => ![...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f),
  "Provider rarity contains invalid characters"
)

export const enrichmentSnapshotSchema = z.object({
  provider: z.literal("TCGDEX"), providerCardId: providerIdentifierSchema, providerSetId: providerIdentifierSchema,
  name: z.string().trim().min(1).max(512), localId: boundedDiagnosticSchema, category: boundedDiagnosticSchema,
  referenceArtworkUrl: z.string().url().max(2048).optional(), illustrator: z.string().trim().min(1).max(256).optional(), providerRarity: z.string().trim().min(1).max(128).optional(),
  rarityCandidate: z.union([
    z.object({ status: z.literal("MAPPED"), providerValue: providerRarityValueSchema, rarity: raritySchema, iconKey: iconKeySchema }).strict(),
    z.object({ status: z.literal("UNMAPPED"), providerValue: providerRarityValueSchema }).strict(),
  ]).optional(),
  pokedexNumbers: z.array(z.number().int().positive()).max(100).optional(), types: z.array(boundedDiagnosticSchema).max(32).optional(),
  variants: z.object({ normal: z.boolean(), reverse: z.boolean(), holo: z.boolean(), firstEdition: z.boolean() }),
}).strict()

export const tcgdexMatchResultSchema = z.union([
  z.object({ code: z.literal("MATCHED"), source: z.enum(["AUTOMATIC", "MANUAL"]), enrichment: enrichmentSnapshotSchema }),
  z.object({ code: z.literal("NO_MATCH"), source: z.enum(["AUTOMATIC", "MANUAL"]), reason: z.literal("NOT_FOUND") }),
  z.object({ code: z.literal("UNRESOLVED_SET"), source: z.enum(["AUTOMATIC", "MANUAL"]), setCode: boundedDiagnosticSchema }),
  z.object({ code: z.literal("IDENTITY_MISMATCH"), source: z.enum(["AUTOMATIC", "MANUAL"]), expected: z.object({ setId: providerIdentifierSchema.optional(), localId: boundedDiagnosticSchema }), actual: z.object({ setId: providerIdentifierSchema, localId: boundedDiagnosticSchema }) }),
  z.object({ code: z.literal("INVALID_LOCAL_IDENTITY"), source: z.enum(["AUTOMATIC", "MANUAL"]), field: z.enum(["language", "setCode", "cardNumber", "reference"]) }),
  z.object({ code: z.literal("PROVIDER_ERROR"), source: z.enum(["AUTOMATIC", "MANUAL"]), providerCode: boundedDiagnosticSchema, attemptCount: z.number().int().positive().max(1000) }),
])

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalize(entry)]))
  }
  return value
}

export function canonicalSnapshot(value: unknown) {
  return enrichmentSnapshotSchema.parse(canonicalize(value))
}

export function snapshotFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalSnapshot(value))).digest("hex")
}

export function diagnosticFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}
