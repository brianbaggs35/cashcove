import { addDays, todayIso } from '@/utils/dates'
import type { PaymentFrequency } from '@/api/subscriptions'
import {
  costs,
  daysUntil,
  estimatedAmount,
  expectedAmount,
  expectsPayment,
  frequencies,
  frequencyTitle,
  hasEnded,
  nextOnSchedule,
  paysAgain,
  priceChange,
  standing,
} from '@/views/subscriptions/recurrence'

describe('subscription recurrence', () => {
  it('offers the supported payment frequencies', () => {
    expect(frequencies.map(({ value }) => value)).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'bimonthly',
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
      'Every two months',
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
    ['bimonthly', '10.00', '5.00', '60.00'],
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

  describe('where it ends', () => {
    const TODAY = '2026-10-19'

    it('has ended from the day it ends on, and not before; one that has no end never does', () => {
      expect(hasEnded({ ends_on: null }, TODAY)).toBe(false)
      expect(hasEnded({ ends_on: '2026-10-20' }, TODAY)).toBe(false)
      expect(hasEnded({ ends_on: '2026-10-19' }, TODAY)).toBe(true)
      expect(hasEnded({ ends_on: '2026-10-18' }, TODAY)).toBe(true)
    })

    it('reads the end against the real today unless told another day', () => {
      expect(hasEnded({ ends_on: todayIso() })).toBe(true)
      expect(hasEnded({ ends_on: addDays(todayIso(), 1) })).toBe(false)
    })

    it.each([
      // Being tracked or paused, when it carries on.
      [true, null, null, 'active'],
      [false, null, null, 'paused'],
      // It is to end but hasn't, so it is as it was.
      [true, '2026-10-20', null, 'active'],
      [false, '2026-10-20', null, 'paused'],
      // Cancelled is cancelled, from the moment it is, paused or not.
      [true, '2026-10-20', '2026-10-01', 'cancelled'],
      [false, '2026-10-20', '2026-10-01', 'cancelled'],
      // Once the day has come, it is over, however it got there.
      [true, '2026-10-19', null, 'cancelled'],
      [false, '2026-10-01', null, 'cancelled'],
      [true, '2026-10-01', '2026-09-01', 'cancelled'],
    ])('stands as %s, ends %s, cancelled %s: %s', (active, endsOn, cancelledOn, expected) => {
      expect(standing({ active, ends_on: endsOn, cancelled_on: cancelledOn }, TODAY)).toBe(expected)
    })

    it('stands against the real today unless told another day', () => {
      const base = { active: true, cancelled_on: null }
      expect(standing({ ...base, ends_on: todayIso() })).toBe('cancelled')
      expect(standing({ ...base, ends_on: addDays(todayIso(), 1) })).toBe('active')
    })

    it.each([
      [null, '2026-10-20', true],
      ['2026-11-20', '2026-10-20', true],
      // Nothing is paid on the day it ends, or after it.
      ['2026-10-20', '2026-10-20', false],
      ['2026-10-19', '2026-10-20', false],
      ['2026-10-21', '2026-10-20', true],
    ])('pays again with an end of %s and a next payment on %s: %s', (endsOn, due, expected) => {
      expect(paysAgain({ ends_on: endsOn, next_due_date: due })).toBe(expected)
    })

    it.each([
      // Carrying on, paused or not, it talks of its next payment.
      [true, null, null, '2026-10-20', true],
      [false, null, null, '2026-10-20', true],
      // Unless it ends on or before then, or has to end before it is paid.
      [true, '2026-11-20', null, '2026-10-20', true],
      [true, '2026-10-20', null, '2026-10-20', false],
      // A stopped one talks of its end, even with a payment due before it ends.
      [true, '2026-11-20', '2026-10-01', '2026-10-20', false],
      [false, '2026-11-20', '2026-10-01', '2026-10-20', false],
      [true, '2026-10-19', null, '2026-10-01', false],
    ])(
      'with active %s, ends %s, cancelled %s and next due %s it talks of its next payment: %s',
      (active, endsOn, cancelledOn, due, expected) => {
        const subscription = {
          active,
          ends_on: endsOn,
          cancelled_on: cancelledOn,
          next_due_date: due,
        }

        expect(expectsPayment(subscription, TODAY)).toBe(expected)
      },
    )

    it('reads the real today unless told another day', () => {
      const base = { active: true, cancelled_on: null, next_due_date: addDays(todayIso(), 9) }
      expect(expectsPayment({ ...base, ends_on: addDays(todayIso(), 30) })).toBe(true)
      expect(expectsPayment({ ...base, ends_on: todayIso() })).toBe(false)
    })
  })

  describe('picking one up again', () => {
    const TODAY = '2026-09-20'

    // The same cases the API is tested with, so what the dialog offers is what the API would pick.
    it.each<[PaymentFrequency, string, string]>([
      ['weekly', '2026-09-01', '2026-09-22'],
      ['biweekly', '2026-08-01', '2026-09-26'],
      ['monthly', '2026-01-31', '2026-09-30'],
      ['bimonthly', '2026-01-15', '2026-11-15'],
      ['quarterly', '2025-12-05', '2026-12-05'],
      ['semiannual', '2025-03-10', '2027-03-10'],
      ['annual', '2024-03-05', '2027-03-05'],
      // Today isn't before today, so it comes back due today; yesterday's is a cycle on.
      ['monthly', '2026-09-20', '2026-09-20'],
      ['monthly', '2026-09-19', '2026-10-19'],
      ['weekly', '2026-09-13', '2026-09-20'],
      ['weekly', '2026-09-12', '2026-09-26'],
    ])('a %s one last due %s next falls due on %s', (frequency, due, expected) => {
      expect(nextOnSchedule({ frequency, next_due_date: due }, TODAY)).toBe(expected)
    })

    it.each<[PaymentFrequency, string]>([
      ['weekly', '2026-09-30'],
      ['biweekly', '2026-10-04'],
      ['monthly', '2026-11-02'],
      ['annual', '2027-05-01'],
    ])('keeps a %s next payment that is still to come: %s', (frequency, due) => {
      expect(nextOnSchedule({ frequency, next_due_date: due }, TODAY)).toBe(due)
    })

    it('counts a short month from the day it was due, so it does not move for good', () => {
      // Due on the 31st, five months on is the 30th of a month with 30 days, and the next is the 31st.
      expect(
        nextOnSchedule({ frequency: 'monthly', next_due_date: '2026-03-31' }, '2026-09-01'),
      ).toBe('2026-09-30')
      expect(
        nextOnSchedule({ frequency: 'monthly', next_due_date: '2026-03-31' }, '2026-10-01'),
      ).toBe('2026-10-31')
    })

    it('counts from today unless told another day', () => {
      const next = nextOnSchedule({ frequency: 'weekly', next_due_date: addDays(todayIso(), -20) })
      expect(daysUntil(next)).toBeGreaterThanOrEqual(0)
      expect(daysUntil(next)).toBeLessThan(7)
    })

    it('says what it costs in a month and in a year, from what the next payment is expected to be', () => {
      expect(costs({ amount: '14.99', expected_amount: '14.99', frequency: 'monthly' })).toEqual({
        month: '14.99',
        year: '179.88',
      })
      expect(costs({ amount: '30.00', expected_amount: '30.00', frequency: 'bimonthly' })).toEqual({
        month: '15.00',
        year: '180.00',
      })
      // A bill that changes every time costs what recent payments say.
      expect(costs({ amount: '90.00', expected_amount: '115.00', frequency: 'monthly' })).toEqual({
        month: '115.00',
        year: '1380.00',
      })
    })
  })
})
