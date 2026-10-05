import type { CategoryTotal } from '@/api/budget'
import type { Subscription } from '@/api/subscriptions'
import { makeSubscription } from '@/test/subscriptions'
import { SLICES, changeBetween, dueSoon, dueText, slices, toneOf } from '@/views/dashboard/summary'

describe('changeBetween', () => {
  it.each([
    ['120.00', '100.00', 2000, 'up'],
    ['80.50', '100.00', 1950, 'down'],
    ['100.00', '100.00', 0, 'same'],
    ['0.00', '0.00', 0, 'same'],
  ])('compares %s with %s', (current, before, cents, direction) => {
    expect(changeBetween(current, before)).toEqual({ cents, direction })
  })

  it('works in whole cents, so no rounding creeps in', () => {
    expect(changeBetween('0.30', '0.10')).toEqual({ cents: 20, direction: 'up' })
  })
})

describe('toneOf', () => {
  it.each([
    ['up', true, 'good'],
    ['down', true, 'bad'],
    ['up', false, 'bad'],
    ['down', false, 'good'],
    ['same', true, 'neutral'],
    ['same', false, 'neutral'],
  ] as const)('%s is %s when up is good: %s', (direction, upIsGood, tone) => {
    expect(toneOf(direction, upIsGood)).toBe(tone)
  })
})

describe('slices', () => {
  const spend = (id: string | null, amount: string, count = 1): CategoryTotal => ({
    category_id: id,
    amount,
    count,
  })

  it('has a slice for each category, in the order given, each in its own colour', () => {
    expect(slices([spend('a', '50.00', 2), spend(null, '25.25')])).toEqual([
      {
        key: 'a',
        categoryId: 'a',
        rest: false,
        cents: 5000,
        count: 2,
        color: 'var(--chart-cat-1)',
      },
      {
        key: 'none',
        categoryId: null,
        rest: false,
        cents: 2525,
        count: 1,
        color: 'var(--chart-cat-2)',
      },
    ])
  })

  it('folds the categories past the first few into one slice', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) =>
      spend(id, `${70 - index * 10}.00`, index + 1),
    )

    const result = slices(many)

    expect(result).toHaveLength(SLICES + 1)
    expect(result.slice(0, SLICES).map((slice) => slice.key)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(result.at(-1)).toEqual({
      key: 'rest',
      categoryId: null,
      rest: true,
      cents: 2000 + 1000,
      count: 6 + 7,
      color: 'var(--chart-other)',
    })
  })

  it('leaves out anything that was not spent', () => {
    expect(slices([spend('a', '0.00'), spend('b', '-5.00')])).toEqual([])
    expect(slices([])).toEqual([])
  })
})

describe('dueSoon', () => {
  const item = (changes: Partial<Subscription>) => makeSubscription(changes)

  it('lists what is overdue or due soon, the soonest first, and ignores the rest', () => {
    const found = dueSoon(
      [
        item({ id: 'later', name: 'Later', next_due_date: '2026-10-20' }),
        item({ id: 'soon', name: 'Soon', next_due_date: '2026-09-24' }),
        item({ id: 'late', name: 'Late', next_due_date: '2026-09-18' }),
        item({ id: 'edge', name: 'Edge', next_due_date: '2026-10-04' }),
        item({ id: 'paused', name: 'Paused', next_due_date: '2026-09-21', active: false }),
      ],
      '2026-09-20',
    )

    expect(found.map(({ id, days }) => [id, days])).toEqual([
      ['late', -2],
      ['soon', 4],
      ['edge', 14],
    ])
  })

  it('breaks ties by name and says what each is expected to cost', () => {
    const found = dueSoon(
      [
        item({ id: 'b', name: 'Bravo', next_due_date: '2026-09-22', amount: '10.00' }),
        item({
          id: 'a',
          name: 'Alpha',
          kind: 'bill',
          next_due_date: '2026-09-22',
          amount: '90.00',
          expected_amount: '96.40',
        }),
      ],
      '2026-09-20',
      3,
    )

    expect(found.map(({ id, kind, amount }) => [id, kind, amount])).toEqual([
      ['a', 'bill', '96.40'],
      ['b', 'subscription', '10.00'],
    ])
  })

  it('counts whole days, whatever the clocks did in between', () => {
    const found = dueSoon([item({ next_due_date: '2026-11-02' })], '2026-10-30')

    expect(found.map((due) => due.days)).toEqual([3])
  })
})

describe('dueText', () => {
  it.each([
    [-2, 'Overdue by 2 days'],
    [-1, 'Overdue by 1 day'],
    [0, 'Due today'],
    [1, 'Due tomorrow'],
    [5, 'Due in 5 days'],
  ])('says %s days away is "%s"', (days, text) => {
    expect(dueText(days)).toBe(text)
  })
})
