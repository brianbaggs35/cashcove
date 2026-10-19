import {
  addDays,
  addMonths,
  formatDateRange,
  formatListDate,
  fromIsoDate,
  periodRange,
  periods,
  toIsoDate,
  todayIso,
  type PeriodKey,
} from '@/utils/dates'

const now = new Date(2026, 8, 20, 15, 30)

describe('date utils', () => {
  it('reads and writes days as local dates', () => {
    const date = fromIsoDate('2026-03-05')
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2026, 2, 5, 0,
    ])
    expect(toIsoDate(date)).toBe('2026-03-05')
    expect(todayIso(now)).toBe('2026-09-20')
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it.each([
    // The same day, as many months on.
    ['2026-09-20', 1, '2026-10-20'],
    ['2026-09-20', 12, '2027-09-20'],
    ['2026-09-20', 0, '2026-09-20'],
    // Across the end of a year, forward and back.
    ['2026-12-15', 1, '2027-01-15'],
    ['2026-12-15', 2, '2027-02-15'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-03-15', -14, '2025-01-15'],
    // A short month ends on its own last day, and a leap year has one more.
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-08-31', 1, '2026-09-30'],
    ['2028-02-29', 12, '2029-02-28'],
    ['2028-02-29', 48, '2032-02-29'],
    // Counted from the day it started, so a short month doesn't move it for good.
    ['2026-01-31', 2, '2026-03-31'],
  ])('%s and %i months is %s', (day, months, expected) => {
    expect(addMonths(day, months)).toBe(expected)
  })

  it.each<[PeriodKey, string | undefined, string | undefined]>([
    ['all', undefined, undefined],
    ['this-month', '2026-09-01', '2026-09-20'],
    ['last-month', '2026-08-01', '2026-08-31'],
    ['last-30-days', '2026-08-22', '2026-09-20'],
    ['last-90-days', '2026-06-23', '2026-09-20'],
    ['this-year', '2026-01-01', '2026-09-20'],
    ['last-year', '2025-01-01', '2025-12-31'],
  ])('%s covers %s to %s', (period, start, end) => {
    expect(periodRange(period, now)).toEqual({ start, end })
  })

  it('counts from today by default', () => {
    expect(periodRange('this-year').end).toBe(todayIso())
    expect(periods.map((period) => period.value)).toContain('last-90-days')
  })

  it('last month crosses into last year in January', () => {
    expect(periodRange('last-month', new Date(2026, 0, 10))).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    })
  })

  it('formats days in lists without this year', () => {
    expect(formatListDate('2026-09-18', 'en-US', now)).toBe('Sep 18')
    expect(formatListDate('2025-12-31', 'en-US', now)).toBe('Dec 31, 2025')
    expect(formatListDate('2026-09-18', 'de-DE', now)).toBe('18. Sept.')
    expect(formatListDate(todayIso())).not.toMatch(/\d{4}/)
  })

  it('formats ranges of days', () => {
    const plain = (text: string) => text.replace(/\s/g, ' ')
    expect(plain(formatDateRange({ start: '2026-09-01', end: '2026-09-20' }))).toBe(
      'Sep 1 – 20, 2026',
    )
    expect(formatDateRange({ start: '2026-09-01' })).toBe('From Sep 1, 2026')
    expect(formatDateRange({ end: '2026-09-20' }, 'en-GB')).toBe('Until 20 Sept 2026')
    expect(formatDateRange({})).toBe('All time')
  })
})
