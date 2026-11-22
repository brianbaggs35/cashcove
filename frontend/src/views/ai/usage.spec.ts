import type { UsageDay } from '@/api/ai'
import {
  bucketize,
  canGroup,
  defaultGrouping,
  GROUPINGS,
  MEASURES,
  measured,
  RANGES,
} from '@/views/ai/usage'

/** Every day from `first`, `count` of them, with `calls` calls on each. */
function span(first: string, count: number, calls = 1): UsageDay[] {
  const start = new Date(`${first}T12:00:00Z`)
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10)
    return { day, calls, tokens: calls * 1000, cost_micros: calls * 500 }
  })
}

const total = (days: readonly { calls: number }[]) =>
  days.reduce((sum, item) => sum + item.calls, 0)

describe('bucketize by day', () => {
  it('has a bar for each day', () => {
    const buckets = bucketize(span('2026-09-14', 7), 'day')

    expect(buckets).toHaveLength(7)
    expect(buckets[0]).toEqual({
      key: '2026-09-14',
      label: 'Sep 14',
      full: 'Sep 14, 2026',
      calls: 1,
      tokens: 1000,
      cost_micros: 500,
      partial: false,
    })
    expect(bucketize(span('2026-09-01', 31), 'day')).toHaveLength(31)
  })

  it('reads dates in the household’s locale', () => {
    expect(bucketize(span('2026-09-14', 7), 'day', 'de-DE')[0]).toMatchObject({
      full: '14.09.2026',
    })
  })

  it('has no bars for no days', () => {
    expect(bucketize([], 'day')).toEqual([])
    expect(bucketize([], 'week')).toEqual([])
    expect(bucketize([], 'month')).toEqual([])
  })
})

describe('bucketize by week', () => {
  // The 14th of September 2026 is a Monday.
  it('has a bar for each calendar week, from the day the household’s weeks start on', () => {
    const days = span('2026-09-14', 21, 2)

    const sundays = bucketize(days, 'week')
    expect(sundays.map((bucket) => bucket.key)).toEqual([
      '2026-09-13',
      '2026-09-20',
      '2026-09-27',
      '2026-10-04',
    ])
    expect(sundays.map((bucket) => bucket.calls)).toEqual([12, 14, 14, 2])

    const mondays = bucketize(days, 'week', 'en-US', 'monday')
    expect(mondays.map((bucket) => bucket.key)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28'])
    expect(mondays.map((bucket) => bucket.calls)).toEqual([14, 14, 14])
    expect(mondays.every((bucket) => !bucket.partial)).toBe(true)
    expect(total(sundays)).toBe(42)
  })

  it('says which days a week covers, and marks one the range cuts into', () => {
    const [first, middle, last] = bucketize(span('2026-09-14', 21), 'week')

    // Cut at the start: the Sunday before the range isn't in it.
    expect(first).toMatchObject({ label: 'Sep 14', partial: true })
    expect(first?.full).toMatch(/^Sep 14\s*[–-]\s*19, 2026$/)
    expect(middle).toMatchObject({ label: 'Sep 20', partial: false })
    expect(middle?.full).toMatch(/^Sep 20\s*[–-]\s*26, 2026$/)
    expect(last?.full).toMatch(/^Sep 27\s*[–-]\s*Oct 3, 2026$/)
  })

  it('marks the week that is still going', () => {
    const buckets = bucketize(span('2026-09-14', 10), 'week', 'en-US', 'monday')

    expect(buckets).toHaveLength(2)
    expect(buckets[1]).toMatchObject({ key: '2026-09-21', calls: 3, partial: true })
    expect(buckets[1]?.full).toMatch(/^Sep 21\s*[–-]\s*23, 2026$/)
  })

  it('reads a week in the household’s locale', () => {
    const [week] = bucketize(span('2026-09-14', 7), 'week', 'de-DE', 'monday')

    expect(week?.full).toMatch(/^14\.\s*[–-]\s*20\.09\.2026$/)
  })
})

describe('bucketize by month', () => {
  it('has a bar for each calendar month, and says which one', () => {
    const buckets = bucketize(span('2025-10-07', 365), 'month')

    expect(buckets.map((bucket) => bucket.label).slice(0, 3)).toEqual(['Oct', 'Nov', 'Dec'])
    expect(buckets).toHaveLength(13)
    expect(buckets[1]).toMatchObject({
      key: '2025-11-01',
      full: 'November 2025',
      calls: 30,
      partial: false,
    })
    expect(total(buckets)).toBe(365)
  })

  it('marks the months the range cuts into, and says which days it covers', () => {
    const buckets = bucketize(span('2025-10-07', 365), 'month')
    const [first] = buckets
    const last = buckets.at(-1)

    expect(first).toMatchObject({ key: '2025-10-01', calls: 25, partial: true })
    expect(first?.full).toMatch(/^Oct 7\s*[–-]\s*31, 2025$/)
    expect(last).toMatchObject({ key: '2026-10-01', partial: true })
    expect(last?.full).toMatch(/^Oct 1\s*[–-]\s*6, 2026$/)
  })

  it('has a bar for a month the range covers whole', () => {
    const [month] = bucketize(span('2026-02-01', 28), 'month')

    expect(month).toMatchObject({ full: 'February 2026', calls: 28, partial: false })
  })

  it('says a single day on its own', () => {
    const buckets = bucketize(span('2026-09-30', 2), 'month')

    expect(buckets[0]?.full).toBe('Sep 30, 2026')
    expect(buckets[1]?.full).toBe('Oct 1, 2026')
  })
})

describe('what can be shown', () => {
  it('offers a week, a month, a quarter and a year', () => {
    expect(RANGES.map((range) => range.value)).toEqual([7, 30, 90, 365])
  })

  it('offers days, weeks and months, and cost, tokens and calls', () => {
    expect(GROUPINGS.map((grouping) => grouping.value)).toEqual(['day', 'week', 'month'])
    expect(MEASURES.map((measure) => measure.value)).toEqual(['cost', 'tokens', 'calls'])
  })

  it('shows a short range by the day, a quarter by the week and a year by the month', () => {
    expect(RANGES.map((range) => defaultGrouping(range.value))).toEqual([
      'day',
      'day',
      'week',
      'month',
    ])
  })

  it('never has more bars than can be told apart', () => {
    expect(RANGES.map((range) => canGroup(range.value, 'day'))).toEqual([true, true, false, false])
    expect(RANGES.map((range) => canGroup(range.value, 'week'))).toEqual([true, true, true, true])
    expect(RANGES.map((range) => canGroup(range.value, 'month'))).toEqual([true, true, true, true])
    // And a bar of what suits each range always can be had.
    for (const range of RANGES)
      expect(canGroup(range.value, defaultGrouping(range.value))).toBe(true)
  })

  it('reads a bar as dollars, tokens or calls', () => {
    const [bucket] = bucketize(
      [{ day: '2026-09-14', calls: 3, tokens: 4200, cost_micros: 2_500_000 }],
      'day',
    )

    expect(measured(bucket!, 'cost')).toBe(2.5)
    expect(measured(bucket!, 'tokens')).toBe(4200)
    expect(measured(bucket!, 'calls')).toBe(3)
  })
})
