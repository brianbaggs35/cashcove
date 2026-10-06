import type { UsageDay } from '@/api/ai'
import { fromIsoDate } from '@/utils/dates'

/** One bar of the usage chart: a day, a week or a month of calls. */
export interface UsageBucket {
  key: string
  /** Short, to put under the bar. */
  label: string
  /** In full, for the table and for anyone not looking at the picture. */
  full: string
  calls: number
  tokens: number
  cost_micros: number
}

/** The ranges that can be looked at. */
export const RANGES = [
  { value: 7, title: '7 days' },
  { value: 30, title: '30 days' },
  { value: 90, title: '90 days' },
  { value: 365, title: 'A year' },
] as const

/** A range of up to this many days shows a bar for each day; a longer one is weeks, then months. */
const DAILY = 31
const WEEKLY = 100

function add(into: UsageBucket, day: UsageDay) {
  into.calls += day.calls
  into.tokens += day.tokens
  into.cost_micros += day.cost_micros
}

function empty(key: string, label: string, full: string): UsageBucket {
  return { key, label, full, calls: 0, tokens: 0, cost_micros: 0 }
}

/**
 * The days of a range as bars: every day for a short range, a week at a time for a longer one and
 * a month at a time for a year, so there are never more bars than can be told apart or reached.
 */
export function bucketize(days: readonly UsageDay[], locale = 'en-US'): UsageBucket[] {
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const long = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const date = (day: string) => fromIsoDate(day)

  if (days.length <= DAILY) {
    return days.map((day) => ({
      ...day,
      key: day.day,
      label: short.format(date(day.day)),
      full: long.format(date(day.day)),
    }))
  }

  const buckets = new Map<string, UsageBucket>()
  days.forEach((day, index) => {
    const weekly = days.length <= WEEKLY
    const key = weekly ? String(Math.floor(index / 7)) : day.day.slice(0, 7)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = weekly
        ? empty(key, short.format(date(day.day)), `The week of ${long.format(date(day.day))}`)
        : empty(
            key,
            new Intl.DateTimeFormat(locale, { month: 'short' }).format(date(day.day)),
            new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
              date(day.day),
            ),
          )
      buckets.set(key, bucket)
    }
    add(bucket, day)
  })
  return [...buckets.values()]
}
