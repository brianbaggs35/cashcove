import { estimatedAmount, frequencies } from '@/views/subscriptions/recurrence'

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
})
