import type { UsageDay } from '@/api/ai'
import { bucketize, RANGES } from '@/views/ai/usage'

/** Every day from `first`, `count` of them, with `calls` calls on each. */
function span(first: string, count: number, calls = 1): UsageDay[] {
  const start = new Date(`${first}T12:00:00Z`)
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10)
    return { day, calls, tokens: calls * 1000, cost_micros: calls * 500 }
  })
}

describe('bucketize', () => {
  it('has a bar for each day of a short range', () => {
    const buckets = bucketize(span('2026-09-14', 7))

    expect(buckets).toHaveLength(7)
    expect(buckets[0]).toEqual({
      day: '2026-09-14',
      key: '2026-09-14',
      label: 'Sep 14',
      full: 'Sep 14, 2026',
      calls: 1,
      tokens: 1000,
      cost_micros: 500,
    })
    expect(bucketize(span('2026-09-01', 31))).toHaveLength(31)
  })

  it('has a bar for each week of a longer one, the last of them part of a week', () => {
    const buckets = bucketize(span('2026-07-01', 90, 2))

    expect(buckets).toHaveLength(13)
    expect(buckets[0]).toMatchObject({
      label: 'Jul 1',
      full: 'The week of Jul 1, 2026',
      calls: 14,
      tokens: 14_000,
      cost_micros: 7_000,
    })
    expect(buckets[12]).toMatchObject({ calls: 2 * 6 })
    expect(buckets.reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(180)
  })

  it('has a bar for each month of a year', () => {
    const buckets = bucketize(span('2025-10-07', 365))

    expect(buckets.map((bucket) => bucket.label).slice(0, 3)).toEqual(['Oct', 'Nov', 'Dec'])
    expect(buckets[0]).toMatchObject({ full: 'October 2025', calls: 25 })
    expect(buckets).toHaveLength(13)
    expect(buckets.reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(365)
  })

  it('reads dates in the household’s locale', () => {
    expect(bucketize(span('2026-09-14', 7), 'de-DE')[0]).toMatchObject({ full: '14.09.2026' })
  })

  it('has no bars for no days', () => {
    expect(bucketize([])).toEqual([])
  })

  it('offers a week, a month, a quarter and a year', () => {
    expect(RANGES.map((range) => range.value)).toEqual([7, 30, 90, 365])
  })
})
