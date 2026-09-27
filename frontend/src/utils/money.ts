// Amounts travel between the API and the app as strings with two decimals, e.g. "-612.40".
// Sums are done in whole cents so they stay exact.

export const MAX_AMOUNT_DIGITS = 12

export function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100)
}

export function fromCents(cents: number): string {
  // Adding 0 turns -0 into 0, so nothing reads "-0.00".
  return (cents / 100 + 0).toFixed(2)
}

export function sumAmounts(amounts: (string | number)[]): string {
  return fromCents(amounts.reduce<number>((total, amount) => total + toCents(amount), 0))
}

export function negate(amount: string): string {
  return fromCents(-toCents(amount))
}

/** The characters a number format groups thousands with and marks decimals with. */
export function separators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  }
}

/**
 * Reads an amount the way people type it, into the API's form: "1,234.5" becomes "1234.50".
 * Either separator works for decimals, so "12,50" and "12.50" both mean twelve fifty, while a
 * separator followed by three digits groups thousands, as in "1.234" or "1,234,567" (unless it's
 * the number format's decimal separator). Returns null when the text isn't an amount of money.
 */
export function parseAmount(text: string, locale = 'en-US'): string | null {
  const cleaned = text
    .replace(/\p{Sc}/gu, '')
    .replace(/[\s']/g, '')
    .replace(/^\u2212/, '-')
  const match = /^([-+]?)([\d.,]*)$/.exec(cleaned)
  if (!match) return null
  const [, sign = '', body = ''] = match
  const marks = [...body.matchAll(/[.,]/g)]
  const last = marks.at(-1)
  let decimalAt = -1
  if (last) {
    const mixed = new Set(marks.map(([mark]) => mark)).size > 1
    const groupsThousands = body.length - last.index === 4 && last[0] !== separators(locale).decimal
    if (mixed || (marks.length === 1 && !groupsThousands)) decimalAt = last.index
  }
  const whole = decimalAt < 0 ? body : body.slice(0, decimalAt)
  const fraction = decimalAt < 0 ? '' : body.slice(decimalAt + 1)
  if (/[.,]/.test(whole) && !/^\d{1,3}([.,]\d{3})+$/.test(whole)) return null
  const digits = whole.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '')
  if (!/^\d{0,2}$/.test(fraction) || digits.length + fraction.length === 0) return null
  if (digits.length > MAX_AMOUNT_DIGITS) return null
  const amount = `${digits || '0'}.${fraction.padEnd(2, '0')}`
  return sign === '-' && toCents(amount) !== 0 ? `-${amount}` : amount
}

/** An amount as it reads in a form field, in the household's number format, e.g. "1,234.50". */
export function amountForInput(amount: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount))
}
