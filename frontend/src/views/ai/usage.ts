import type { UsageDay } from '@/api/ai'
import { addDays, addMonths, fromIsoDate } from '@/utils/dates'

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
  /** Less than the whole week or month, because the range starts or ends part-way through it. */
  partial: boolean
}

/** The ranges that can be looked at. */
export const RANGES = [
  { value: 7, title: '7 days' },
  { value: 30, title: '30 days' },
  { value: 90, title: '90 days' },
  { value: 365, title: 'A year' },
] as const

/** What a bar of the chart stands for. */
export type Grouping = 'day' | 'week' | 'month'

export const GROUPINGS: readonly { value: Grouping; title: string }[] = [
  { value: 'day', title: 'Day' },
  { value: 'week', title: 'Week' },
  { value: 'month', title: 'Month' },
]

/** What the chart measures: what the AI cost, how many tokens it used, or how often it was asked. */
export type Measure = 'cost' | 'tokens' | 'calls'

export const MEASURES: readonly { value: Measure; title: string }[] = [
  { value: 'cost', title: 'Cost' },
  { value: 'tokens', title: 'Tokens' },
  { value: 'calls', title: 'Calls' },
]

/** The day a week starts on, as the household chose it. */
export type WeekStart = 'sunday' | 'monday'

/** A range of up to this many days shows a bar for each day; a longer one is weeks, then months. */
const DAILY = 31
const WEEKLY = 100
/** The most bars that can be told apart, and reached with a pointer or a finger. */
const MAX_BARS = 60

/** The most bars a range of `days` days makes when it is grouped so. */
function barsOf(days: number, by: Grouping): number {
  if (by === 'day') return days
  // Whole weeks and months, and a part of one at either end.
  return Math.ceil(days / (by === 'week' ? 7 : 28)) + 1
}

/** Whether a range can be shown by `by` without more bars than can be told apart. */
export const canGroup = (days: number, by: Grouping): boolean => barsOf(days, by) <= MAX_BARS

/** What a range is shown by unless another is asked for: a bar for each day, then each week. */
export function defaultGrouping(days: number): Grouping {
  if (days <= DAILY) return 'day'
  return days <= WEEKLY ? 'week' : 'month'
}

/** What a bar stands for in the measure being drawn: dollars, tokens or calls. */
export function measured(bucket: UsageBucket, measure: Measure): number {
  if (measure === 'cost') return bucket.cost_micros / 1_000_000
  return measure === 'tokens' ? bucket.tokens : bucket.calls
}

/** The words for dates in the household's locale. */
function formats(locale: string) {
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const long = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const month = new Intl.DateTimeFormat(locale, { month: 'short' })
  const monthAndYear = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
  return {
    short: (day: string) => short.format(fromIsoDate(day)),
    long: (day: string) => long.format(fromIsoDate(day)),
    month: (day: string) => month.format(fromIsoDate(day)),
    monthAndYear: (day: string) => monthAndYear.format(fromIsoDate(day)),
    /** A stretch of days: "Sep 28 – Oct 4, 2026", or the one day it is. */
    span: (from: string, to: string) =>
      from === to
        ? long.format(fromIsoDate(from))
        : long.formatRange(fromIsoDate(from), fromIsoDate(to)),
  }
}

/** The first day of the week or month that `day` is in. */
function startOf(day: string, by: 'week' | 'month', weekStartsOn: WeekStart): string {
  if (by === 'month') return `${day.slice(0, 7)}-01`
  const sinceWeekStarted = (fromIsoDate(day).getDay() - (weekStartsOn === 'monday' ? 1 : 0) + 7) % 7
  return addDays(day, -sinceWeekStarted)
}

/** The last day of the week or month that starts on `start`. */
const endOf = (start: string, by: 'week' | 'month') =>
  by === 'week' ? addDays(start, 6) : addDays(addMonths(start, 1), -1)

/**
 * The days of a range as bars: a bar for each day, or each calendar week (from the day the
 * household's weeks start on) or month. A week or month the range cuts into is marked `partial`
 * and says which days it covers, so a short bar is never mistaken for a quiet week.
 */
export function bucketize(
  days: readonly UsageDay[],
  by: Grouping,
  locale = 'en-US',
  weekStartsOn: WeekStart = 'sunday',
): UsageBucket[] {
  const first = days[0]?.day
  const last = days.at(-1)?.day
  if (first === undefined || last === undefined) return []
  const words = formats(locale)

  if (by === 'day') {
    return days.map((day) => ({
      key: day.day,
      label: words.short(day.day),
      full: words.long(day.day),
      calls: day.calls,
      tokens: day.tokens,
      cost_micros: day.cost_micros,
      partial: false,
    }))
  }

  const buckets = new Map<string, UsageBucket>()
  for (const day of days) {
    const start = startOf(day.day, by, weekStartsOn)
    let bucket = buckets.get(start)
    if (!bucket) {
      const end = endOf(start, by)
      // ISO dates sort as the days they are.
      const from = start < first ? first : start
      const to = end > last ? last : end
      const partial = from !== start || to !== end
      const whole = by === 'month' && !partial
      bucket = {
        key: start,
        label: by === 'week' ? words.short(from) : words.month(start),
        full: whole ? words.monthAndYear(start) : words.span(from, to),
        calls: 0,
        tokens: 0,
        cost_micros: 0,
        partial,
      }
      buckets.set(start, bucket)
    }
    bucket.calls += day.calls
    bucket.tokens += day.tokens
    bucket.cost_micros += day.cost_micros
  }
  return [...buckets.values()]
}
