import {
  estimatedAmount,
  expectedAmount,
  frequencies,
  frequencyTitle,
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
})
