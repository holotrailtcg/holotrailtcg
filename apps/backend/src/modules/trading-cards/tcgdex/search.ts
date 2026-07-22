import type { TcgDexSetCardSummary, TcgDexSetDetail } from "./types"

export interface TcgdexSearchCandidate {
  tcgdexSetId: string
  tcgdexCardId: string
  localId: string
  name: string
  image: string | null
  setName: string
}

const SEARCH_RESULT_LIMIT = 30

/**
 * Stage 1 alternative-match search: filters one already-fetched set's card
 * list down to candidates matching a reviewer's free-text query (by name or
 * local card number), so the Admin UI can display enough distinguishing
 * information (name, artwork, local number, set) to tell visually similar
 * cards apart — see the Stage 1 spec's "alternative TCGdex selection"
 * requirements. A blank/absent query returns every card in the set, bounded
 * to `SEARCH_RESULT_LIMIT` so a large set never floods the response.
 */
export function searchTcgdexSetCards(setDetail: TcgDexSetDetail, query: string | null | undefined): TcgdexSearchCandidate[] {
  const cards: TcgDexSetCardSummary[] = setDetail.cards ?? []
  const normalizedQuery = (query ?? "").trim().toLowerCase()
  const filtered = normalizedQuery
    ? cards.filter((card) => card.name.toLowerCase().includes(normalizedQuery) || card.localId.toLowerCase() === normalizedQuery)
    : cards
  return filtered.slice(0, SEARCH_RESULT_LIMIT).map((card) => ({
    tcgdexSetId: setDetail.id,
    tcgdexCardId: card.id,
    localId: card.localId,
    name: card.name,
    image: card.image ?? null,
    setName: setDetail.name,
  }))
}
