import {
  currencyName,
  currencySymbol,
  formatCountdown,
  formatDateTime,
  formatDay,
  formatLongDate,
  formatMoney,
  formatRelative,
  formatShortDate,
  formatTime,
  greeting,
  localeName,
  monthName,
} from '@/utils/format'

/** Intl may use narrow no-break spaces, e.g. before "PM". */
const plain = (text: string) => text.replace(/\s/g, ' ')

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

  it.each([
    [10, 'just now'],
    [-30, 'just now'],
    [-5 * 60, '5 minutes ago'],
    [-3 * 3600, '3 hours ago'],
    [2 * 3600, 'in 2 hours'],
    [-24 * 3600, 'yesterday'],
    [-3 * 24 * 3600, '3 days ago'],
  ])('describes %i seconds from now as %s', (seconds, expected) => {
    const now = new Date(2026, 8, 25, 12)
    expect(formatRelative(new Date(now.getTime() + seconds * 1000), now)).toBe(expected)
  })

  it('shows the date for anything more than a week away', () => {
    const now = new Date(2026, 8, 25, 12)
    expect(formatRelative(new Date(2026, 8, 1, 12), now)).toBe('Sep 1, 2026')
    expect(formatRelative(new Date(2026, 8, 1, 12).toISOString(), now, 'de-DE')).toBe('01.09.2026')
    expect(typeof formatRelative(new Date())).toBe('string')
  })

  it('formats dates with times, and times alone', () => {
    const date = new Date(2026, 8, 25, 15, 4)
    expect(plain(formatDateTime(date))).toBe('Sep 25, 2026, 3:04 PM')
    expect(plain(formatDateTime(date.toISOString(), 'en-GB'))).toBe('25 Sept 2026, 15:04')
    expect(plain(formatTime(date))).toBe('3:04 PM')
    expect(formatTime(date.toISOString(), 'de-DE')).toBe('15:04')
  })

  it.each([
    [0, '0 seconds'],
    [-5, '0 seconds'],
    [1, '1 second'],
    [0.2, '1 second'],
    [45, '45 seconds'],
    [60, '1:00'],
    [65, '1:05'],
    [600, '10:00'],
  ])('counts down %d seconds as %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected)
  })

  it('names days in a list', () => {
    const now = new Date(2026, 8, 25, 9)
    expect(formatDay(new Date(2026, 8, 25, 23, 59), now)).toBe('Today')
    expect(formatDay(new Date(2026, 8, 24, 0, 1), now)).toBe('Yesterday')
    expect(formatDay(new Date(2026, 8, 21, 12).toISOString(), now)).toBe('Monday, September 21')
    expect(formatDay(new Date(2025, 11, 31, 12), now)).toBe('Wednesday, December 31, 2025')
    expect(formatDay(new Date(2026, 8, 21, 12), now, 'en-GB')).toBe('Monday 21 September')
    expect(typeof formatDay(new Date())).toBe('string')
  })
})
