import {
  currencyName,
  currencySymbol,
  formatLongDate,
  formatMoney,
  formatShortDate,
  greeting,
  localeName,
  monthName,
} from '@/utils/format'

describe('format utils', () => {
  it.each([
    [2, 'Good evening'],
    [8, 'Good morning'],
    [13, 'Good afternoon'],
    [21, 'Good evening'],
  ])('greets at %i:00 with %s', (hour, expected) => {
    expect(greeting(new Date(2026, 8, 25, hour))).toBe(expected)
  })

  it('formats dates', () => {
    const date = new Date(2026, 8, 25)
    expect(formatLongDate(date)).toBe('Friday, September 25')
    expect(formatLongDate(date, 'en-GB')).toBe('Friday 25 September')
    expect(formatShortDate(date)).toBe('Sep 25, 2026')
    expect(formatShortDate(date, 'de-DE')).toBe('25.09.2026')
  })

  it('formats money from numbers and decimal strings', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50')
    expect(formatMoney('99.99', 'EUR', 'de-DE')).toBe('99,99\u00a0€')
  })

  it('finds the currency symbol', () => {
    expect(currencySymbol()).toBe('$')
    expect(currencySymbol('GBP', 'en-GB')).toBe('£')
  })

  it('falls back to the currency code when there is no symbol part', () => {
    vi.spyOn(Intl.NumberFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'integer', value: '0' },
    ])
    expect(currencySymbol('XYZ')).toBe('XYZ')
  })

  it('names months', () => {
    expect(monthName(1)).toBe('January')
    expect(monthName(10, 'fr-FR')).toBe('octobre')
  })

  it('names currencies and locales', () => {
    expect(currencyName('EUR')).toBe('Euro')
    expect(localeName('en-GB')).toBe('British English')
  })

  it('falls back to the code when a name is unknown', () => {
    vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue(undefined)
    expect(currencyName('XYZ')).toBe('XYZ')
  })
})
