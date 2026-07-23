/** Pulse's `providerReference` encodes the card number as `<setCode>|<cardNumber>/<totalNumber>`. */
export function parseCardNumber(providerReference: string) {
  const numberReference = providerReference.split("|")[1] ?? ""
  const [cardNumber, totalNumber] = numberReference.split("/")

  return {
    cardNumber: cardNumber || null,
    totalNumber: totalNumber || null,
  }
}
