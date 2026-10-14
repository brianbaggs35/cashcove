import { addDays, todayIso } from '@/utils/dates'
import {
  daysUntil,
  estimatedAmount,
  expectedAmount,
  frequencies,
  frequencyTitle,
  priceChange,
} from '@/views/subscriptions/recurrence'

describe('subscription recurrence', () => {
  it('offers the supported payment frequencies', () => {
    expect(frequencies.map(({ value }) => value)).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
      'semiannual',
      'annual',
    ])
  })

  it('names each frequency in words', () => {
    expect(frequencies.map(({ value }) => frequencyTitle(value))).toEqual([
      'Weekly',
      'Every two weeks',
      'Monthly',
      'Every three months',
      'Every six months',
      'Annually',
    ])
    expect(frequencies.map(({ title }) => title)).toEqual(
      frequencies.map(({ value }) => frequencyTitle(value)),
    )
  })

  it.each([
    ['weekly', '10.00', '43.33', '520.00'],
    ['biweekly', '10.00', '21.67', '260.00'],
    ['monthly', '10.00', '10.00', '120.00'],
    ['quarterly', '10.00', '3.33', '40.00'],
    ['semiannual', '10.00', '1.67', '20.00'],
    ['annual', '10.00', '0.83', '10.00'],
  ] as const)('estimates %s payments in whole cents', (frequency, amount, monthly, yearly) => {
    expect(estimatedAmount(amount, frequency, 'month')).toBe(monthly)
    expect(estimatedAmount(amount, frequency, 'year')).toBe(yearly)
  })

  it('expects what the API says, or the amount it was set up with', () => {
    expect(expectedAmount({ amount: '100.00', expected_amount: '115.00' })).toBe('115.00')
    expect(expectedAmount({ amount: '100.00', expected_amount: null })).toBe('100.00')
  })

  it('counts the days to a day, backwards once it has gone by', () => {
    expect(daysUntil('2026-10-20', '2026-10-14')).toBe(6)
    expect(daysUntil('2026-10-14', '2026-10-14')).toBe(0)
    expect(daysUntil('2026-10-12', '2026-10-14')).toBe(-2)
    // A month that is longer or shorter, and a year, don't change what a day is.
    expect(daysUntil('2027-03-01', '2027-02-28')).toBe(1)
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2)
  })

  it('counts from today unless told another day', () => {
    expect(daysUntil(todayIso())).toBe(0)
    expect(daysUntil(addDays(todayIso(), 3))).toBe(3)
  })

  it('notices a last payment that is not the amount, but not for one that changes every time', () => {
    const base = { amount: '15.49', amount_varies: false, last_payment_amount: '17.99' }
    expect(priceChange(base)).toBe('17.99')
    expect(priceChange({ ...base, last_payment_amount: '15.49' })).toBeNull()
    // Paid to the cent, however it is written.
    expect(priceChange({ ...base, last_payment_amount: '15.490' })).toBeNull()
    expect(priceChange({ ...base, last_payment_amount: null })).toBeNull()
    expect(priceChange({ ...base, amount_varies: true })).toBeNull()
  })
})
