export function formatMoney(value: string | null, currencyCode: string | null): string {
  if (value === null) return "—"
  const amount = Number(value)
  if (!currencyCode || Number.isNaN(amount)) return value
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currencyCode }).format(amount)
  } catch {
    return `${currencyCode} ${value}`
  }
}
