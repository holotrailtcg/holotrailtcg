import { RARITY, RARITY_ICON_KEY, type Rarity, type RarityIconKey } from "../types"
import type { TcgDexCard } from "./types"
import type { CardEnrichmentData, NormalizedRarityCandidate } from "./matching-types"

const RARITY_MAP: Record<string, { rarity: Rarity; iconKey: RarityIconKey }> = {
  "ACE SPEC Rare": { rarity: RARITY.ACE_SPEC, iconKey: RARITY_ICON_KEY.ACE_SPEC },
  "Black White Rare": { rarity: RARITY.BLACK_WHITE_RARE, iconKey: RARITY_ICON_KEY.BLACK_WHITE_RARE },
  Common: { rarity: RARITY.COMMON, iconKey: RARITY_ICON_KEY.COMMON },
  "Double Rare": { rarity: RARITY.DOUBLE_RARE, iconKey: RARITY_ICON_KEY.DOUBLE_RARE },
  "Hyper Rare": { rarity: RARITY.HYPER_RARE, iconKey: RARITY_ICON_KEY.HYPER_RARE },
  "Illustration Rare": { rarity: RARITY.ILLUSTRATION_RARE, iconKey: RARITY_ICON_KEY.ILLUSTRATION_RARE },
  "Mega Attack Rare": { rarity: RARITY.MEGA_ATTACK_RARE, iconKey: RARITY_ICON_KEY.MEGA_ATTACK_RARE },
  "Mega Hyper Rare": { rarity: RARITY.MEGA_HYPER_RARE, iconKey: RARITY_ICON_KEY.MEGA_HYPER_RARE },
  Promo: { rarity: RARITY.PROMO, iconKey: RARITY_ICON_KEY.PROMO },
  "Shiny Ultra Rare": { rarity: RARITY.SHINY_ULTRA_RARE, iconKey: RARITY_ICON_KEY.SHINY_ULTRA_RARE },
  "Ultra Rare": { rarity: RARITY.ULTRA_RARE, iconKey: RARITY_ICON_KEY.ULTRA_RARE },
  Uncommon: { rarity: RARITY.UNCOMMON, iconKey: RARITY_ICON_KEY.UNCOMMON },
}

export function normalizeTcgdexRarity(value?: string): NormalizedRarityCandidate | undefined {
  if (!value) return undefined
  const mapped = RARITY_MAP[value]
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
    variants: { ...card.variants },
  }
}
