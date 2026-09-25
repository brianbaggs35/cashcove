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

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5 minutes ago", "yesterday", "3 days ago", then the date itself. */
export function formatRelative(value: Date | string, now = new Date(), locale = 'en-US'): string {
  const date = new Date(value)
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const distance = Math.abs(seconds)
  if (distance < 45) return 'just now'
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (distance < HOUR) return relative.format(Math.round(seconds / MINUTE), 'minute')
  if (distance < DAY) return relative.format(Math.round(seconds / HOUR), 'hour')
  if (distance < 7 * DAY) return relative.format(Math.round(seconds / DAY), 'day')
  return formatShortDate(date, locale)
}

/** A date and time, e.g. "Sep 25, 2026, 3:04 PM". */
export function formatDateTime(value: Date | string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

/** A countdown, e.g. "1:05", or "45 seconds" when under a minute. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  if (whole < MINUTE) return whole === 1 ? '1 second' : `${whole} seconds`
  const minutes = Math.floor(whole / MINUTE)
  return `${minutes}:${String(whole % MINUTE).padStart(2, '0')}`
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** A heading for a day in a list: "Today", "Yesterday", then e.g. "Monday, September 21". */
export function formatDay(value: Date | string, now = new Date(), locale = 'en-US'): string {
  const date = new Date(value)
  const days = Math.round((startOfDay(now) - startOfDay(date)) / (DAY * 1000))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

/** A time of day, e.g. "3:04 PM". */
export function formatTime(value: Date | string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(value))
}
