// Days travel as ISO dates, e.g. "2026-09-20", and mean that day wherever the household is.
// `new Date("2026-09-20")` would be midnight in London, the day before in New York, so these
// helpers read and write them as local days.

const pad = (value: number) => String(value).padStart(2, '0')

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day)
}

export function todayIso(now = new Date()): string {
  return toIsoDate(now)
}

export function addDays(value: string, days: number): string {
  const date = fromIsoDate(value)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

export type PeriodKey =
  'all' | 'this-month' | 'last-month' | 'last-30-days' | 'last-90-days' | 'this-year' | 'last-year'

export interface DateRange {
  start?: string
  end?: string
}

export const periods: { value: PeriodKey; title: string }[] = [
  { value: 'all', title: 'All time' },
  { value: 'this-month', title: 'This month' },
  { value: 'last-month', title: 'Last month' },
  { value: 'last-30-days', title: 'Last 30 days' },
  { value: 'last-90-days', title: 'Last 90 days' },
  { value: 'this-year', title: 'This year' },
  { value: 'last-year', title: 'Last year' },
]

/** The days a period covers, counted from today. */
export function periodRange(period: PeriodKey, now = new Date()): DateRange {
  const year = now.getFullYear()
  const month = now.getMonth()
  const today = toIsoDate(now)
  switch (period) {
    case 'this-month':
      return { start: toIsoDate(new Date(year, month, 1)), end: today }
    case 'last-month':
      return {
        start: toIsoDate(new Date(year, month - 1, 1)),
        end: toIsoDate(new Date(year, month, 0)),
      }
    case 'last-30-days':
      return { start: addDays(today, -29), end: today }
    case 'last-90-days':
      return { start: addDays(today, -89), end: today }
    case 'this-year':
      return { start: `${year}-01-01`, end: today }
    case 'last-year':
      return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` }
    case 'all':
      return {}
  }
}

/** A date in a list: "Sep 20" this year, "Sep 20, 2025" before. */
export function formatListDate(value: string, locale = 'en-US', now = new Date()): string {
  const date = fromIsoDate(value)
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

/** A range of days, e.g. "Sep 1 – 20, 2026", or from or until one day when the other is open. */
export function formatDateRange({ start, end }: DateRange, locale = 'en-US'): string {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  if (start && end) return format.formatRange(fromIsoDate(start), fromIsoDate(end))
  if (start) return `From ${format.format(fromIsoDate(start))}`
  if (end) return `Until ${format.format(fromIsoDate(end))}`
  return 'All time'
}
