import {
  amountForInput,
  fromCents,
  negate,
  parseAmount,
  separators,
  sumAmounts,
  toCents,
} from '@/utils/money'

describe('money utils', () => {
  it('adds up amounts exactly', () => {
    expect(toCents('0.10') + toCents('0.20')).toBe(30)
    expect(sumAmounts(['0.10', '0.20', -0.05])).toBe('0.25')
    expect(sumAmounts([])).toBe('0.00')
    expect(fromCents(-123456)).toBe('-1234.56')
    expect(fromCents(-0)).toBe('0.00')
    expect(negate('-612.40')).toBe('612.40')
    expect(negate('0.00')).toBe('0.00')
  })

  it('knows how each number format writes numbers', () => {
    expect(separators('en-US')).toEqual({ group: ',', decimal: '.' })
    expect(separators('de-DE')).toEqual({ group: '.', decimal: ',' })
  })

  it('falls back to commas and points when a format has no separators', () => {
    vi.spyOn(Intl.NumberFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'integer', value: '12345' },
    ])
    expect(separators('xx')).toEqual({ group: ',', decimal: '.' })
  })

  it.each([
    ['42', '42.00'],
    ['42.5', '42.50'],
    ['42,5', '42.50'],
    ['.5', '0.50'],
    ['5.', '5.00'],
    ['007.25', '7.25'],
    ['1,234', '1234.00'],
    ['1,234.56', '1234.56'],
    ['1.234,56', '1234.56'],
    ['1,234,567', '1234567.00'],
    [' $ 1 234.50 ', '1234.50'],
    ["1'234.50", '1234.50'],
    ['-12.50', '-12.50'],
    ['−12.50', '-12.50'],
    ['+12', '12.00'],
    ['-0', '0.00'],
    ['999999999999.99', '999999999999.99'],
  ])('reads %j as %s', (text, amount) => {
    expect(parseAmount(text)).toBe(amount)
  })

  it.each([
    [''],
    ['-'],
    ['abc'],
    ['12abc'],
    ['1.234'],
    ['1,23,4'],
    ['12.345.67'],
    ['4.2.1'],
    ['1e5'],
    ['1000000000000'],
  ])('refuses %j', (text) => {
    expect(parseAmount(text)).toBeNull()
  })

  it('reads a single separator before three digits the way the number format does', () => {
    expect(parseAmount('1.234', 'de-DE')).toBe('1234.00')
    expect(parseAmount('1,234', 'de-DE')).toBeNull()
    expect(parseAmount('12,5', 'de-DE')).toBe('12.50')
    expect(parseAmount('1 234,50', 'fr-FR')).toBe('1234.50')
  })

  it('shows amounts for editing in the number format', () => {
    expect(amountForInput('1234.5')).toBe('1,234.50')
    expect(amountForInput('-1234.5', 'de-DE')).toBe('-1.234,50')
  })
})
