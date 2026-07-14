import { RARITY, RARITY_ICON_KEY, type Rarity, type RarityIconKey } from "../types"
import type { TcgDexCard } from "./types"
import type { CardEnrichmentData, NormalizedRarityCandidate } from "./matching-types"

const RARITY_MAP: Record<string, { rarity: Rarity; iconKey: RarityIconKey }> = {
  "ace spec rare": { rarity: RARITY.ACE_SPEC, iconKey: RARITY_ICON_KEY.ACE_SPEC },
  "black white rare": { rarity: RARITY.BLACK_WHITE_RARE, iconKey: RARITY_ICON_KEY.BLACK_WHITE_RARE },
  common: { rarity: RARITY.COMMON, iconKey: RARITY_ICON_KEY.COMMON },
  "double rare": { rarity: RARITY.DOUBLE_RARE, iconKey: RARITY_ICON_KEY.DOUBLE_RARE },
  "hyper rare": { rarity: RARITY.HYPER_RARE, iconKey: RARITY_ICON_KEY.HYPER_RARE },
  "illustration rare": { rarity: RARITY.ILLUSTRATION_RARE, iconKey: RARITY_ICON_KEY.ILLUSTRATION_RARE },
  "mega attack rare": { rarity: RARITY.MEGA_ATTACK_RARE, iconKey: RARITY_ICON_KEY.MEGA_ATTACK_RARE },
  "mega hyper rare": { rarity: RARITY.MEGA_HYPER_RARE, iconKey: RARITY_ICON_KEY.MEGA_HYPER_RARE },
  promo: { rarity: RARITY.PROMO, iconKey: RARITY_ICON_KEY.PROMO },
  "shiny ultra rare": { rarity: RARITY.SHINY_ULTRA_RARE, iconKey: RARITY_ICON_KEY.SHINY_ULTRA_RARE },
  "ultra rare": { rarity: RARITY.ULTRA_RARE, iconKey: RARITY_ICON_KEY.ULTRA_RARE },
  uncommon: { rarity: RARITY.UNCOMMON, iconKey: RARITY_ICON_KEY.UNCOMMON },
}

export function normalizeTcgdexRarity(value?: string): NormalizedRarityCandidate | undefined {
  if (!value) return undefined
  const mapped = RARITY_MAP[value.trim().toLowerCase()]
  return mapped ? { status: "MAPPED", providerValue: value, ...mapped } : { status: "UNMAPPED", providerValue: value }
}

export function normalizeTcgdexCard(card: TcgDexCard): CardEnrichmentData {
  return {
    provider: "TCGDEX",
    providerCardId: card.id,
    providerSetId: card.set.id,
    name: card.name,
    localId: card.localId,
    category: card.category,
    ...(card.image ? { referenceArtworkUrl: card.image } : {}),
    ...(card.illustrator ? { illustrator: card.illustrator } : {}),
    ...(card.rarity ? { providerRarity: card.rarity, rarityCandidate: normalizeTcgdexRarity(card.rarity) } : {}),
    ...(card.dexId ? { pokedexNumbers: [...card.dexId] } : {}),
    ...(card.types ? { types: [...card.types] } : {}),
    variants: {
      normal: card.variants.normal,
      reverse: card.variants.reverse,
      holo: card.variants.holo,
      firstEdition: card.variants.firstEdition,
    },
  }
}
