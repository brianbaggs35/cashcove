export function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Good evening'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function formatLongDate(date: Date, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

export function formatShortDate(date: Date, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

export function formatMoney(amount: number | string, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount))
}

export function currencySymbol(currency = 'USD', locale = 'en-US'): string {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0)
  return parts.find((part) => part.type === 'currency')?.value ?? currency
}

export function monthName(month: number, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  )
}

function displayName(type: Intl.DisplayNamesType, code: string): string {
  return new Intl.DisplayNames('en', { type }).of(code) ?? code
}

export const currencyName = (code: string) => displayName('currency', code)
export const localeName = (code: string) => displayName('language', code)
