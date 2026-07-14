import type { CardEnrichmentData, NormalizedCardVariants, TcgDexMatchResult } from "../index"
import type { TcgDexCard } from "../types"

// Keep the raw adapter contract implementation-private.
// @ts-expect-error TcgDexLookupClient must not be a public Stage 4A.2 export.
import type { TcgDexLookupClient } from "../index"

type Assert<T extends true> = T
type AssertFalse<T extends false> = T
type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

type _MatchedEnrichment = Assert<IsEqual<Extract<TcgDexMatchResult, { code: "MATCHED" }>["enrichment"], CardEnrichmentData>>
type _ProviderIndependentVariants = AssertFalse<IsEqual<NormalizedCardVariants, TcgDexCard["variants"]>>
type _NoRawResult = AssertFalse<TcgDexMatchResult extends TcgDexCard ? true : false>
