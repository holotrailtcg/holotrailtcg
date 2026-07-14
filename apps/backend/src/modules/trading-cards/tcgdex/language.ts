import { TCGDEX_ERROR_CODE, TcgDexError } from "./errors"
import { TCGDEX_LANGUAGE, type TcgDexApiLanguage, type TcgDexLanguage } from "./types"

export function mapTcgDexLanguage(language: TcgDexLanguage | string): TcgDexApiLanguage {
  if (!(language in TCGDEX_LANGUAGE)) {
    throw new TcgDexError({
      code: TCGDEX_ERROR_CODE.INVALID_REQUEST,
      message: "Unsupported TCGdex language",
      operation: "map-language",
    })
  }

  return TCGDEX_LANGUAGE[language]
}
