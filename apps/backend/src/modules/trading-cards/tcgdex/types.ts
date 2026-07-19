export const TCGDEX_LANGUAGE = {
  EN: "en",
  JA: "ja",
  ZH: "zh-tw",
} as const

export type TcgDexLanguage = keyof typeof TCGDEX_LANGUAGE
export type TcgDexApiLanguage = (typeof TCGDEX_LANGUAGE)[TcgDexLanguage]

export type TcgDexCard = {
  category: string
  id: string
  localId: string
  name: string
  image?: string
  illustrator?: string
  rarity?: string
  set: TcgDexSet
  variants: TcgDexVariants
  boosters?: TcgDexBooster[]
  updated?: string
  dexId?: number[]
  hp?: number
  types?: string[]
  evolveFrom?: string
  description?: string
  level?: string
  stage?: string
  suffix?: string
  item?: TcgDexEffect
  effect?: string
  trainerType?: string
  energyType?: string
}

export type TcgDexSetSummary = {
  id: string
  name: string
}

export type TcgDexSetDetail = TcgDexSet & {
  serie: TcgDexSetSummary
}

export type TcgDexSet = {
  id: string
  name: string
  logo?: string
  symbol?: string
  cardCount?: {
    official?: number
    total?: number
  }
}

export type TcgDexVariants = {
  normal: boolean
  reverse: boolean
  holo: boolean
  firstEdition: boolean
  wPromo?: boolean
}

export type TcgDexBooster = {
  id: string
  name: string
  logo?: string
  artwork_front?: string
  artwork_back?: string
}

export type TcgDexEffect = {
  name: string
  effect: string
}

export type TcgDexFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type TcgDexClientDependencies = {
  fetchImpl?: TcgDexFetch
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
}

