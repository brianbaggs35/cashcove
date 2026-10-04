import {
  budgetStatus,
  percentSpent,
  periodLabel,
  periodOptions,
  shortPeriodLabel,
} from '@/views/budget/periods'

/** ICU puts thin spaces around the dash of a range. */
const plain = (text: string) => text.replace(/[\u2009\u202f\u00a0]/g, ' ')

describe('budget periods in words', () => {
  it.each([
    ['monthly', '2026-09-01', '2026-09-30', 'September 2026'],
    ['monthly', '2026-02-01', '2026-02-28', 'February 2026'],
    // A month that doesn't start on the 1st, or that spans two, is told by its days.
    ['monthly', '2026-09-15', '2026-10-14', 'Sep 15 – Oct 14, 2026'],
    ['monthly', '2026-09-02', '2026-09-30', 'Sep 2 – 30, 2026'],
    ['weekly', '2026-09-20', '2026-09-26', 'Sep 20 – 26, 2026'],
    ['biweekly', '2026-12-27', '2027-01-09', 'Dec 27, 2026 – Jan 9, 2027'],
    ['yearly', '2026-01-01', '2026-12-31', '2026'],
    ['yearly', '2026-04-01', '2027-03-31', 'Apr 2026 – Mar 2027'],
    ['yearly', '2026-01-01', '2026-11-30', 'Jan – Nov 2026'],
  ] as const)('calls a %s period from %s to %s "%s"', (period, start, end, label) => {
    expect(plain(periodLabel(period, start, end))).toBe(label)
  })

  it('writes dates the way the household does', () => {
    expect(periodLabel('monthly', '2026-09-01', '2026-09-30', 'de-DE')).toBe('September 2026')
    expect(plain(periodLabel('weekly', '2026-09-20', '2026-09-26', 'de-DE'))).toBe(
      '20.–26. Sept. 2026',
    )
  })

  it.each([
    ['monthly', '2026-09-01', 'Sep'],
    ['yearly', '2026-04-01', '2026'],
    ['weekly', '2026-09-20', 'Sep 20'],
    ['biweekly', '2026-09-20', 'Sep 20'],
  ] as const)('names a %s period starting %s "%s" on a chart', (period, start, label) => {
    expect(shortPeriodLabel(period, start)).toBe(label)
  })

  it('offers every way a budget can repeat, in order', () => {
    expect(periodOptions.map((option) => option.value)).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'yearly',
    ])
  })
})

describe('how a budget is doing', () => {
  it.each([
    ['1999.99', '2000.00', 90, 'near'],
    ['1800.00', '2000.00', 90, 'near'],
    ['1799.99', '2000.00', 90, 'ok'],
    ['2000.00', '2000.00', 90, 'near'],
    ['2000.01', '2000.00', 90, 'over'],
    ['1999.99', '2000.00', null, 'ok'],
    ['2000.01', '2000.00', null, 'over'],
    ['-20.00', '2000.00', 90, 'ok'],
  ] as const)('says %s of %s at a threshold of %s is %s', (spent, amount, threshold, status) => {
    expect(budgetStatus(spent, amount, threshold)).toBe(status)
  })

  it('says how much of the amount is spent, past 100 when over', () => {
    expect(percentSpent('500.00', '2000.00')).toBe(25)
    expect(percentSpent('2500.00', '2000.00')).toBe(125)
    expect(percentSpent('10.00', '0.00')).toBe(0)
  })
})
