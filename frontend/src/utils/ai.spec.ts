import { makeModel, makeReview } from '@/test/ai'
import {
  confidenceColors,
  confidenceLabels,
  formatCost,
  formatPrice,
  formatTokens,
  priceLine,
  PRICING_PAGES,
  reviewActive,
  reviewStatusLabels,
  suggestionsOf,
} from '@/utils/ai'

describe('formatCost', () => {
  it.each([
    [0, '$0.00'],
    [400, '$0.0004'],
    [5_750, '$0.0058'],
    [12_300, '$0.012'],
    [999_000, '$0.999'],
    [50_000, '$0.05'],
    [1_230_000, '$1.23'],
    [1_234_560_000, '$1,234.56'],
  ])('shows %d millionths of a dollar as %s', (micros, text) => {
    expect(formatCost(micros)).toBe(text)
  })

  it('says so when it costs less than the smallest amount shown', () => {
    expect(formatCost(50)).toBe('<$0.0001')
    expect(formatCost(1)).toBe('<$0.0001')
    expect(formatCost(100)).toBe('$0.0001')
  })

  it('writes dollars the way the household’s locale does, and says they are US ones', () => {
    expect(formatCost(1_230_000, 'en-CA')).toBe('US$1.23')
    expect(formatCost(1_230_000, 'de-DE')).toBe('1,23 $')
  })
})

describe('formatPrice', () => {
  it.each([
    ['2', '$2.00'],
    ['0.1', '$0.10'],
    ['0.015', '$0.015'],
    ['1.25', '$1.25'],
    ['15', '$15.00'],
  ])('shows %s as %s', (dollars, text) => {
    expect(formatPrice(dollars)).toBe(text)
  })
})

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [1_000, '1K'],
    [42_000, '42K'],
    [1_500_000, '1.5M'],
  ])('shows %d as %s', (tokens, text) => {
    expect(formatTokens(tokens)).toBe(text)
  })
})

describe('priceLine', () => {
  it('says what a million tokens cost in and out', () => {
    expect(priceLine(makeModel())).toBe('$0.10 in · $0.50 out per million tokens')
    expect(priceLine(makeModel({ input_price: '2', output_price: '10' }))).toBe(
      '$2.00 in · $10.00 out per million tokens',
    )
  })

  it('says nothing for a model with no price', () => {
    expect(priceLine(makeModel({ input_price: null, output_price: null }))).toBeNull()
    expect(priceLine(makeModel({ input_price: '1', output_price: null }))).toBeNull()
    expect(priceLine(makeModel({ input_price: null, output_price: '1' }))).toBeNull()
  })
})

describe('labels', () => {
  it('has a price list for each provider that charges', () => {
    expect(Object.keys(PRICING_PAGES).sort()).toEqual(['anthropic', 'ollama_cloud', 'openai'])
    for (const page of Object.values(PRICING_PAGES)) expect(page).toMatch(/^https:\/\//)
  })

  it('words every confidence and status', () => {
    expect(confidenceLabels.high).toBe('High confidence')
    expect(confidenceLabels.medium).toBe('Medium confidence')
    expect(confidenceLabels.low).toBe('Low confidence')
    expect(confidenceColors).toEqual({ high: 'success', medium: 'info', low: 'warning' })
    expect(reviewStatusLabels.pending).toBe('Waiting to start')
    expect(reviewStatusLabels.running).toBe('Reviewing')
    expect(reviewStatusLabels.done).toBe('Finished')
    expect(reviewStatusLabels.failed).toBe('Stopped')
  })

  it('counts what a review suggested, whatever has become of it', () => {
    expect(suggestionsOf(makeReview({ open: 2, applied: 3, dismissed: 1 }))).toBe(6)
    expect(suggestionsOf(makeReview({ open: 0, applied: 0, dismissed: 0 }))).toBe(0)
  })

  it('knows which reviews are still going', () => {
    expect(reviewActive('pending')).toBe(true)
    expect(reviewActive('running')).toBe(true)
    expect(reviewActive('done')).toBe(false)
    expect(reviewActive('failed')).toBe(false)
  })
})
