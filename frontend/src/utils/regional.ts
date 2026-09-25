import { currencyName, localeName, monthName } from '@/utils/format'

// The currencies and number formats offered in Settings and the first-run wizard.

const CURRENCIES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'NZD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'MXN',
  'BRL',
  'INR',
  'CNY',
  'SGD',
  'HKD',
  'ZAR',
]

const LOCALES = [
  'en-US',
  'en-CA',
  'en-GB',
  'en-AU',
  'fr-CA',
  'fr-FR',
  'de-DE',
  'es-ES',
  'es-MX',
  'it-IT',
  'nl-NL',
  'pt-BR',
  'ja-JP',
]

export const currencyOptions = CURRENCIES.map((code) => ({
  value: code,
  title: `${code} · ${currencyName(code)}`,
}))

export const localeOptions = LOCALES.map((code) => ({ value: code, title: localeName(code) }))

export const monthOptions = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  title: monthName(index + 1),
}))
