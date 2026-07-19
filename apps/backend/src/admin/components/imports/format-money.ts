export function formatMoney(value: string | null, currencyCode: string | null): string {
  if (value === null) return "—"
  return currencyCode ? `${currencyCode} ${value}` : value
}
