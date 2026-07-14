export interface PulseFixtureRow {
  source: string
  language: "EN" | "JA" | "ZH"
  productName: string
  set: string
  cardNumber: string
  material: string
  promoInfo: string
  rarity: string
  productId: string
}

// Verified field excerpts from the four Pulse exports supplied on 2026-07-14.
export const VERIFIED_PULSE_ROWS = {
  englishHolo: {
    source: "[ME] eBay Stock - Holos & Reverse Holos.csv", language: "EN", productName: "Xerneas",
    set: "Chaos Rising", cardNumber: "042/086", material: "Holo", promoInfo: "", rarity: "Rare",
    productId: "card:me04|042/086|Holo|null|null|null",
  },
  englishReverseHolo: {
    source: "[ME] eBay Stock - Holos & Reverse Holos.csv", language: "EN", productName: "Trubbish",
    set: "Chaos Rising", cardNumber: "056/086", material: "Reverse Holo", promoInfo: "", rarity: "Common",
    productId: "card:me04|056/086|Reverse Holo|null|null|null",
  },
  japaneseHolo: {
    source: "[JP] eBay Stock - Japanese Mixed.csv", language: "JA", productName: "Spidops ex",
    set: "Violet ex", cardNumber: "008/078", material: "Holo", promoInfo: "", rarity: "Double Rare (RR)",
    productId: "card:sv1v_jp|008/078|Holo|null|null|null",
  },
  chinesePokeBall: {
    source: "[CH] eBay Stock - Chinese Mixed.csv", language: "ZH", productName: "Eevee",
    set: "Gem Pack Vol. 2", cardNumber: "0104/15", material: "Poké Ball", promoInfo: "", rarity: "Common",
    productId: "card:cbb2_scn|0104/15|Poké Ball|null|null|null",
  },
  chineseStarlight: {
    source: "[CH] eBay Stock - Chinese Mixed.csv", language: "ZH", productName: "Vaporeon",
    set: "Gem Pack Vol. 2", cardNumber: "0206/15", material: "Starlight Holo", promoInfo: "", rarity: "Uncommon",
    productId: "card:cbb2_scn|0206/15|Starlight Holo|null|null|null",
  },
  missingMaterial: {
    source: "[SWSH] eBay Stock - Pokémon V, VMAX & VSTAR Cards.csv", language: "EN", productName: "Regigigas V",
    set: "Crown Zenith", cardNumber: "113/159", material: "", promoInfo: "", rarity: "Holo Rare V",
    productId: "card:swsh12pt5|113/159|null|null|null|null",
  },
  lightlyPlayedSuffix: {
    source: "[JP] eBay Stock - Japanese Mixed.csv", language: "JA", productName: "Psyduck",
    set: "Fossil", cardNumber: "53/62", material: "", promoInfo: "", rarity: "Common",
    productId: "card:base3|53/62|null|null|null|null|lp",
  },
  promoPrizePack: {
    source: "[SWSH] eBay Stock - Pokémon V, VMAX & VSTAR Cards.csv", language: "EN", productName: "Alolan Vulpix VSTAR",
    set: "Play! Pokémon Prize Pack Series Three", cardNumber: "034/195", material: "",
    promoInfo: "Play! Pokémon Prize Pack", rarity: "Holo Rare VSTAR",
    productId: "card:pp3|034/195|null|Play! Pokémon Prize Pack|null|null",
  },
  promoWorldChampionship: {
    source: "[SWSH] eBay Stock - Pokémon V, VMAX & VSTAR Cards.csv", language: "EN", productName: "Lugia VSTAR",
    set: "WC Deck 2023 (Colorless Lugia)", cardNumber: "139/195", material: "",
    promoInfo: "Colorless Lugia: Gabriel Fernandez", rarity: "Holo Rare VSTAR",
    productId: "card:wc23cl|139/195|null|Colorless Lugia: Gabriel Fernandez|null|null",
  },
  unknownRarity: {
    source: "[CH] eBay Stock - Chinese Mixed.csv", language: "ZH", productName: "Froslass",
    set: "Gem Pack Vol. 4", cardNumber: "1207/07", material: "Holo", promoInfo: "", rarity: "Unknown",
    productId: "card:cbb4_scn|1207/07|Holo|null|null|null",
  },
  duplicateLeafeon: {
    source: "[CH] eBay Stock - Chinese Mixed.csv", language: "ZH", productName: "Leafeon",
    set: "Gem Pack Vol. 2", cardNumber: "0704/15", material: "Poké Ball", promoInfo: "", rarity: "Common",
    productId: "card:cbb2_scn|0704/15|Poké Ball|null|null|null",
  },
  emDashRarity: {
    source: "[ME] eBay Stock - Holos & Reverse Holos.csv", language: "EN", productName: "fixture-varies",
    set: "fixture-varies", cardNumber: "fixture-varies", material: "Holo", promoInfo: "", rarity: "—",
    productId: "verified-rarity-only",
  },
} satisfies Record<string, PulseFixtureRow>

// The Eevee row occurs twice verbatim in the supplied Chinese export.
export const VERIFIED_DUPLICATE_EEVEE_ROWS = [VERIFIED_PULSE_ROWS.chinesePokeBall, VERIFIED_PULSE_ROWS.chinesePokeBall]

// The Leafeon Product ID occurs three times verbatim in the supplied Chinese export.
export const VERIFIED_DUPLICATE_LEAFEON_ROWS = Array.from(
  { length: 3 },
  () => VERIFIED_PULSE_ROWS.duplicateLeafeon
)

// Structural-only cases: neither value is represented as a complete source row.
export const STRUCTURAL_FIXTURES = {
  mojibakeRarity: "ï¿½",
  highValueIndividuallyTracked: true,
} as const
