/** A day counted from another, as YYYY-MM-DD. */
export function dateInDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** A day in the baseline household's time zone, counted from today, as YYYY-MM-DD. */
export function householdDate(days = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts()
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value)
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days))
    .toISOString()
    .slice(0, 10)
}

/** A day as the app writes it in a list of coming payments, e.g. "Mon, Oct 12, 2026". */
export function longDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, date))
}
