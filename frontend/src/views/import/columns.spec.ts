import {
  amountStyle,
  assignColumn,
  columnFields,
  coveredByBank,
  dateOrders,
  decimalMarks,
  delimiters,
  fieldOf,
} from '@/views/import/columns'
import { makeLayout, makeRow } from '@/test/imports'

const layout = makeLayout()

describe('CSV columns', () => {
  it('offers every field, date order, decimal mark and separator', () => {
    expect(columnFields.map((field) => field.value)).toEqual([
      'date',
      'payee',
      'amount',
      'money_in',
      'money_out',
      'direction',
      'memo',
      'category',
      'id',
      'balance',
    ])
    expect(dateOrders.map((order) => order.value)).toEqual(['mdy', 'dmy', 'ymd'])
    expect(decimalMarks.map((mark) => mark.value)).toEqual(['.', ','])
    expect(delimiters.map((delimiter) => delimiter.value)).toEqual([',', ';', '\t', '|'])
  })

  it('says what a column holds', () => {
    expect(fieldOf(layout.columns, 0)).toBe('date')
    expect(fieldOf(layout.columns, 4)).toBe('id')
    expect(fieldOf(layout.columns, 7)).toBeNull()
  })

  it('tells how amounts are given', () => {
    expect(amountStyle(layout.columns)).toBe('one')
    expect(amountStyle({ ...layout.columns, amount: null, money_in: 5 })).toBe('split')
    expect(amountStyle({ ...layout.columns, amount: null, money_out: 5 })).toBe('split')
    expect(amountStyle({ ...layout.columns, direction: 5 })).toBe('direction')
  })

  it('moves a field to the column it is given', () => {
    const moved = assignColumn(layout, 3, 'payee')
    expect(moved.columns).toMatchObject({ payee: 3, balance: null })
    expect(fieldOf(moved.columns, 1)).toBeNull()

    const skipped = assignColumn(layout, 4, null)
    expect(skipped.columns.id).toBeNull()
    expect(skipped.amounts).toBe('one')
  })

  it('swaps one way of giving amounts for another', () => {
    const split = assignColumn(assignColumn(layout, 2, 'money_out'), 5, 'money_in')
    expect(split.columns).toMatchObject({ amount: null, money_out: 2, money_in: 5 })
    expect(split.amounts).toBe('split')

    const one = assignColumn(split, 2, 'amount')
    expect(one.columns).toMatchObject({ amount: 2, money_out: null, money_in: null })
    expect(one.amounts).toBe('one')

    // Until an amount column joins it, the file says it's missing one.
    const direction = assignColumn(split, 6, 'direction')
    expect(direction.columns).toMatchObject({ direction: 6, money_out: null, money_in: null })
    expect(direction.amounts).toBe('direction')
    expect(assignColumn(direction, 2, 'amount').columns).toMatchObject({ amount: 2, direction: 6 })
  })

  it('keeps the values meaning money in only while the direction column stays', () => {
    const direction = makeLayout({
      columns: { ...layout.columns, direction: 5 },
      amounts: 'direction',
      money_in_values: ['CR'],
    })
    expect(assignColumn(direction, 1, 'memo').money_in_values).toEqual(['CR'])
    expect(assignColumn(direction, 6, 'direction').money_in_values).toEqual([])
    expect(assignColumn(direction, 5, null).money_in_values).toEqual([])
  })

  it('knows the days the bank already shared', () => {
    const row = makeRow({ date: '2026-03-04' })
    expect(coveredByBank(row, null)).toBe(false)
    expect(coveredByBank(makeRow({ date: null }), { start: '2026-01-01', end: null })).toBe(false)
    expect(coveredByBank(row, { start: '2026-03-04', end: null })).toBe(true)
    expect(coveredByBank(row, { start: '2026-03-05', end: null })).toBe(false)
    expect(coveredByBank(row, { start: '2026-01-01', end: '2026-03-04' })).toBe(true)
    expect(coveredByBank(row, { start: '2026-01-01', end: '2026-03-03' })).toBe(false)
  })
})
