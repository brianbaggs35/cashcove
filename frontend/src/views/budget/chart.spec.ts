import {
  columnPath,
  compactMoney,
  linePath,
  nearestIndex,
  niceTicks,
  runningTotal,
  tipShift,
} from '@/views/budget/chart'

describe('chart axes', () => {
  it.each([
    [0, [0, 1], 1],
    [-5, [0, 1], 1],
    [Number.NaN, [0, 1], 1],
    [1, [0, 0.25, 0.5, 0.75, 1], 1],
    [2000, [0, 500, 1000, 1500, 2000], 2000],
    [1983.41, [0, 500, 1000, 1500, 2000], 2000],
    [2150, [0, 1000, 2000, 3000], 3000],
    [9, [0, 2.5, 5, 7.5, 10], 10],
    [650, [0, 200, 400, 600, 800], 800],
    [52000, [0, 20000, 40000, 60000], 60000],
    [3, [0, 1, 2, 3], 3],
    [400, [0, 100, 200, 300, 400], 400],
  ])('puts round ticks on an axis up to %s', (maximum, ticks, top) => {
    expect(niceTicks(maximum)).toEqual({ ticks, max: top })
  })

  it('aims for the number of ticks asked for', () => {
    expect(niceTicks(100, 2).ticks).toEqual([0, 50, 100])
    expect(niceTicks(100, 5).ticks).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('shortens amounts for the axis', () => {
    expect(compactMoney(0)).toBe('$0')
    expect(compactMoney(1500)).toBe('$1.5K')
    expect(compactMoney(2000, 'USD', 'en-US')).toBe('$2K')
    expect(compactMoney(2000000)).toBe('$2M')
    expect(compactMoney(1500, 'EUR', 'de-DE')).toMatch(/^1500\s€$/)
  })

  it('finds the point nearest a position, and never one outside the chart', () => {
    expect(nearestIndex(0, 10)).toBe(0)
    expect(nearestIndex(1, 10)).toBe(9)
    expect(nearestIndex(0.5, 11)).toBe(5)
    expect(nearestIndex(-0.2, 10)).toBe(0)
    expect(nearestIndex(1.3, 10)).toBe(9)
    expect(nearestIndex(0.5, 1)).toBe(0)
  })
})

describe('chart data', () => {
  it('adds up what was spent day by day, carrying the total over quiet days', () => {
    const daily = [
      { day: '2026-09-01', spent: '10.00' },
      { day: '2026-09-03', spent: '5.50' },
      { day: '2026-09-04', spent: '-2.00' },
      { day: '2026-09-30', spent: '99.00' },
    ]

    expect(runningTotal(daily, '2026-09-01', 4)).toEqual([10, 10, 15.5, 13.5, 13.5])
    expect(runningTotal(daily, '2026-09-01', 0)).toEqual([10])
    expect(runningTotal(daily, '2026-09-01', -1)).toEqual([])
  })

  it('draws a line through points', () => {
    expect(
      linePath([
        [0, 10],
        [5.25, 20.04],
        [10, 0],
      ]),
    ).toBe('M0.0 10.0 L5.3 20.0 L10.0 0.0')
    expect(linePath([])).toBe('')
  })
})

describe('chart marks', () => {
  it('draws a column rounded at the end and square on the baseline', () => {
    expect(columnPath(10, 20, 24, 100)).toBe(
      'M10.0 100.0V24.0Q10.0 20.0 14.0 20.0H30.0Q34.0 20.0 34.0 24.0V100.0Z',
    )
  })

  it('rounds no more than the column is wide or tall', () => {
    expect(columnPath(0, 98, 24, 100)).toBe(
      'M0.0 100.0V100.0Q0.0 98.0 2.0 98.0H22.0Q24.0 98.0 24.0 100.0V100.0Z',
    )
    expect(columnPath(0, 10, 6, 100)).toBe(
      'M0.0 100.0V13.0Q0.0 10.0 3.0 10.0H3.0Q6.0 10.0 6.0 13.0V100.0Z',
    )
  })

  it('draws nothing for a column with no height', () => {
    expect(columnPath(0, 100, 24, 100)).toBe('')
    expect(columnPath(0, 120, 24, 100)).toBe('')
    expect(columnPath(0, Number.NaN, 24, 100)).toBe('')
  })

  it('moves a tooltip to stay on the chart: held to either edge, centred between', () => {
    expect(tipShift(10, 640)).toBe('0')
    expect(tipShift(127, 640)).toBe('0')
    expect(tipShift(128, 640)).toBe('-50%')
    expect(tipShift(320, 640)).toBe('-50%')
    expect(tipShift(512, 640)).toBe('-50%')
    expect(tipShift(513, 640)).toBe('-100%')
    expect(tipShift(630, 640)).toBe('-100%')
  })
})
