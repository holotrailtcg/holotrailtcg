import type { ExecArgs } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import fs from "node:fs"
import path from "node:path"
import { parse } from "csv-parse/sync"
import { parseProductId } from "../modules/trading-card-inventory/pulse/product-id"
import { candidateTcgdexSetIds, TcgDexClient, type TcgDexLanguage, type TcgDexSetSummary } from "../modules/trading-cards/tcgdex"
import { CARD_GAME, CARD_LANGUAGE, EXTERNAL_PROVIDER, type CardLanguage } from "../modules/trading-cards/types"
import { TRADING_CARDS_MODULE } from "../modules/trading-cards"
import type TradingCardsModuleService from "../modules/trading-cards/service"

/**
 * KEEP — not disposable. English sets were backfilled 2026-07-21; JA/ZH are
 * still pending, blocked only on Pulse's daily API quota resetting (see
 * project memory `project_pulse_set_mapping_backfill.md`). This script is
 * the actual tool for finishing that open task, not a diagnostic — do not
 * delete it in a later cleanup pass without finishing or explicitly
 * abandoning the JA/ZH backfill first.
 *
 * One-off backfill: pre-populate `ProviderSetMapping` rows for every Pulse
 * set code we can discover, so the "N sets need mapping" banner never has
 * to ask about a set we've already resolved.
 *
 * Two passes:
 *  1. CSV pass — reads every *.csv in BACKFILL_PULSE_CSV_DIR, extracts each
 *     row's Pulse set code (from Product ID) and Pulse set name (from the
 *     Set column), free — no API calls needed for this pass.
 *  2. Live-discovery pass — for every real TCGdex set (all languages seen
 *     in step 1, i.e. EN/JA/ZH) not already resolved by step 1, calls
 *     Pulse's cards/search API for that set's name to discover Pulse's own
 *     set_id for it. Requires PULSE_API_KEY. Throttled to stay well under
 *     Pulse's per-minute rate limit.
 *
 * A mapping is only ever created when the match is unambiguous (exactly one
 * TCGdex set id, or an exact Pulse-reported set name match); anything else
 * is left for the existing manual "Map" dialog rather than guessed.
 *
 * Usage:
 *   $env:BACKFILL_PULSE_CSV_DIR = "C:\Users\scott\Downloads\Pulse Inventories 21.07.2026"
 *   $env:PULSE_API_KEY = "pk_live_..."
 *   pnpm exec medusa exec ./src/scripts/backfill-provider-set-mappings.ts
 */

const PULSE_API_BASE_URL = "https://q.pulseapi.dev"
/** 60 requests/minute confirmed on the dashboard; spacing at ~1.2s keeps a comfortable margin. */
const PULSE_REQUEST_SPACING_MS = 1_200

/**
 * Pulse's own set_id suffix convention for non-English catalogues, confirmed
 * against real cards: TCGdex id `m2a` (Japanese "MEGA Dream ex") is Pulse's
 * `m2a_jp`; TCGdex id `cbb1` (Chinese "Gem Pack Vol. 1") is Pulse's
 * `cbb1_scn`. English carries no suffix. Only a guess — always verified via
 * an exact `set_id` filter lookup before being treated as real.
 */
const PULSE_SET_ID_SUFFIX_BY_LANGUAGE: Record<CardLanguage, string> = { EN: "", JA: "_jp", ZH: "_scn" }

async function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface PulseSetLookupResult {
  setId: string
  setName: string
}

/** Thrown when the daily quota is nearly exhausted, so the script stops and reports partial results instead of blocking for hours on a 429 Retry-After. */
export class PulseDailyBudgetExceededError extends Error {
  constructor(remaining: number) {
    super(`Pulse daily quota nearly exhausted (${remaining} requests remaining) — stopping discovery pass early`)
  }
}

/** Safety margin below Pulse's reported daily remaining count — stop before actually hitting zero. */
const PULSE_DAILY_SAFETY_MARGIN = 10

class PulseDiscoveryClient {
  private lastRequestAt = 0

  constructor(private readonly apiKey: string) {}

  private async throttledFetch(url: URL): Promise<Response> {
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < PULSE_REQUEST_SPACING_MS) await delay(PULSE_REQUEST_SPACING_MS - elapsed)
    this.lastRequestAt = Date.now()
    const response = await fetch(url, { headers: { "x-api-key": this.apiKey, Accept: "application/json" } })

    const dailyRemainingHeader = response.headers.get("X-RateLimit-Remaining")
    if (dailyRemainingHeader !== null) {
      const dailyRemaining = Number(dailyRemainingHeader)
      if (Number.isFinite(dailyRemaining) && dailyRemaining <= PULSE_DAILY_SAFETY_MARGIN) {
        throw new PulseDailyBudgetExceededError(dailyRemaining)
      }
    }

    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "5")
      // A daily/monthly cap can report a multi-hour Retry-After; never sit blocked on that — surface it instead.
      if (retryAfterSeconds > 120) throw new PulseDailyBudgetExceededError(0)
      await delay(Math.max(1, retryAfterSeconds) * 1_000)
      return this.throttledFetch(url)
    }
    return response
  }

  /** Exact set_id filter lookup — only treated as a real match when Pulse's own set_name for it matches the expected name. */
  async findBySetId(setId: string, expectedSetName: string): Promise<PulseSetLookupResult | null> {
    const url = new URL(`${PULSE_API_BASE_URL}/api/v1/cards/search`)
    url.searchParams.set("set_id", setId)
    url.searchParams.set("limit", "1")

    const response = await this.throttledFetch(url)
    if (!response.ok) return null

    const body = await response.json() as { success: boolean; data?: Array<{ set_id: string; set_name: string }> }
    const card = body.data?.[0]
    if (!body.success || !card) return null
    return normalizedSetName(card.set_name) === normalizedSetName(expectedSetName)
      ? { setId: card.set_id, setName: card.set_name }
      : null
  }
}

const LANGUAGE_BY_FILENAME_MARKER: Array<{ marker: string; language: CardLanguage }> = [
  { marker: "[jp]", language: CARD_LANGUAGE.JA },
  { marker: "[ch]", language: CARD_LANGUAGE.ZH },
]

function languageForFilename(filename: string): CardLanguage {
  const lower = filename.toLowerCase()
  const match = LANGUAGE_BY_FILENAME_MARKER.find((entry) => lower.includes(entry.marker))
  return match?.language ?? CARD_LANGUAGE.EN
}

function normalizedSetName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

interface PulseSetOccurrence {
  language: CardLanguage
  providerSetCode: string
  pulseSetName: string | null
}

function collectSetOccurrences(csvDir: string): PulseSetOccurrence[] {
  const files = fs.readdirSync(csvDir).filter((name) => name.toLowerCase().endsWith(".csv"))
  const occurrences = new Map<string, PulseSetOccurrence>()

  for (const file of files) {
    const language = languageForFilename(file)
    const raw = fs.readFileSync(path.join(csvDir, file), "utf8")
    const records: Array<Record<string, string>> = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true })

    for (const record of records) {
      const parsedId = parseProductId(record["Product ID"] ?? "")
      if (!parsedId.setCodeCandidate) continue
      const key = `${language}::${parsedId.setCodeCandidate}`
      if (occurrences.has(key)) continue
      occurrences.set(key, {
        language,
        providerSetCode: parsedId.setCodeCandidate,
        pulseSetName: record["Set"]?.trim() || null,
      })
    }
  }

  return [...occurrences.values()]
}

async function resolveViaCandidateDerivation(
  client: TcgDexClient, language: TcgDexLanguage, tcgdexSets: TcgDexSetSummary[], providerSetCode: string
): Promise<TcgDexSetSummary | null> {
  const candidateIds = candidateTcgdexSetIds(providerSetCode, language)
  const matches = candidateIds
    .map((id) => tcgdexSets.find((set) => set.id.toLowerCase() === id.toLowerCase()))
    .filter((set): set is TcgDexSetSummary => Boolean(set))
  const unique = [...new Map(matches.map((set) => [set.id, set])).values()]
  return unique.length === 1 ? unique[0] : null
}

function resolveViaPulseSetName(tcgdexSets: TcgDexSetSummary[], pulseSetName: string | null): TcgDexSetSummary | null {
  if (!pulseSetName) return null
  const target = normalizedSetName(pulseSetName)
  const matches = tcgdexSets.filter((set) => normalizedSetName(set.name) === target)
  return matches.length === 1 ? matches[0] : null
}

async function createMapping(
  tradingCards: TradingCardsModuleService, client: TcgDexClient,
  language: CardLanguage, providerSetCode: string, tcgdexSet: TcgDexSetSummary
) {
  const detail = await client.getSetById(language as TcgDexLanguage, tcgdexSet.id)
  await tradingCards.createProviderSetMapping({
    provider: EXTERNAL_PROVIDER.PULSE, game: CARD_GAME.POKEMON, language,
    providerSetCode, tcgdexSetId: detail.id, tcgdexSetName: detail.name,
    tcgdexSeriesId: detail.serie.id, tcgdexSeriesName: detail.serie.name,
  })
  return detail
}

export default async function backfillProviderSetMappings({ container }: ExecArgs) {
  const csvDir = process.env.BACKFILL_PULSE_CSV_DIR?.trim()
  if (!csvDir) throw new MedusaError(MedusaError.Types.INVALID_DATA, "BACKFILL_PULSE_CSV_DIR is required")
  if (!fs.existsSync(csvDir)) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Directory not found: ${csvDir}`)
  const pulseApiKey = process.env.PULSE_API_KEY?.trim()
  if (!pulseApiKey) throw new MedusaError(MedusaError.Types.INVALID_DATA, "PULSE_API_KEY is required")

  const tradingCards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const client = new TcgDexClient()
  const pulse = new PulseDiscoveryClient(pulseApiKey)

  const created: Array<{ language: CardLanguage; providerSetCode: string; tcgdexSetId: string; tcgdexSetName: string; via: string }> = []
  const skipped: Array<{ language: CardLanguage; providerSetCode: string | null; tcgdexSetId?: string; tcgdexSetName?: string; reason: string }> = []
  const resolvedKeys = new Set<string>() // `${language}::${providerSetCode}`

  // Pass 1: CSV-derived occurrences (free, no API calls beyond TCGdex listSets)
  const occurrences = collectSetOccurrences(csvDir)
  const languages = [...new Set(occurrences.map((entry) => entry.language)), CARD_LANGUAGE.EN, CARD_LANGUAGE.JA, CARD_LANGUAGE.ZH]
  const setsByLanguage = new Map<CardLanguage, TcgDexSetSummary[]>()
  for (const language of new Set(languages)) {
    setsByLanguage.set(language, await client.listSets(language as TcgDexLanguage))
  }

  for (const occurrence of occurrences) {
    const key = `${occurrence.language}::${occurrence.providerSetCode}`
    const existing = await tradingCards.findProviderSetMapping({
      provider: EXTERNAL_PROVIDER.PULSE, game: CARD_GAME.POKEMON,
      language: occurrence.language, providerSetCode: occurrence.providerSetCode,
    })
    if (existing) {
      resolvedKeys.add(key)
      skipped.push({ language: occurrence.language, providerSetCode: occurrence.providerSetCode, reason: "already mapped" })
      continue
    }

    const tcgdexSets = setsByLanguage.get(occurrence.language) ?? []
    let matched = await resolveViaCandidateDerivation(client, occurrence.language as TcgDexLanguage, tcgdexSets, occurrence.providerSetCode)
    let via = "code derivation"
    if (!matched) {
      matched = resolveViaPulseSetName(tcgdexSets, occurrence.pulseSetName)
      via = "Pulse set name (CSV)"
    }

    if (!matched) {
      skipped.push({ language: occurrence.language, providerSetCode: occurrence.providerSetCode, reason: "no unambiguous match (CSV pass)" })
      continue
    }

    const detail = await createMapping(tradingCards, client, occurrence.language, occurrence.providerSetCode, matched)
    resolvedKeys.add(key)
    created.push({ language: occurrence.language, providerSetCode: occurrence.providerSetCode, tcgdexSetId: detail.id, tcgdexSetName: detail.name, via })
  }

  // Pass 2: live Pulse-search discovery for every remaining TCGdex set (EN/JA/ZH)
  for (const language of [CARD_LANGUAGE.EN, CARD_LANGUAGE.JA, CARD_LANGUAGE.ZH] as const) {
    const tcgdexSets = setsByLanguage.get(language) ?? []
    for (const tcgdexSet of tcgdexSets) {
      // Skip sets already mapped to some provider_set_code in pass 1.
      const alreadyMappedForThisSet = created.some((entry) => entry.language === language && entry.tcgdexSetId === tcgdexSet.id)
      if (alreadyMappedForThisSet) continue

      const guessedSetId = `${tcgdexSet.id}${PULSE_SET_ID_SUFFIX_BY_LANGUAGE[language]}`
      const result = await pulse.findBySetId(guessedSetId, tcgdexSet.name)
      if (!result) {
        skipped.push({ language, providerSetCode: null, tcgdexSetId: tcgdexSet.id, tcgdexSetName: tcgdexSet.name, reason: "not found in Pulse" })
        continue
      }

      const key = `${language}::${result.setId}`
      if (resolvedKeys.has(key)) continue // discovered a code we already mapped in pass 1

      const existing = await tradingCards.findProviderSetMapping({
        provider: EXTERNAL_PROVIDER.PULSE, game: CARD_GAME.POKEMON, language, providerSetCode: result.setId,
      })
      if (existing) {
        resolvedKeys.add(key)
        skipped.push({ language, providerSetCode: result.setId, tcgdexSetId: tcgdexSet.id, tcgdexSetName: tcgdexSet.name, reason: "already mapped" })
        continue
      }

      const detail = await createMapping(tradingCards, client, language, result.setId, tcgdexSet)
      resolvedKeys.add(key)
      created.push({ language, providerSetCode: result.setId, tcgdexSetId: detail.id, tcgdexSetName: detail.name, via: "Pulse live search" })
    }
  }

  console.log(JSON.stringify({
    csvOccurrencesSeen: occurrences.length,
    createdCount: created.length,
    skippedCount: skipped.length,
    created, skipped,
  }, null, 2))
}
