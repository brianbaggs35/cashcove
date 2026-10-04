import {
  amountFields,
  amountLimits,
  amountPhrase,
  amountMode,
  amountRange,
  amountsValid,
  keyOf,
  matchItems,
  nameFor,
} from '@/views/automations/looks'

describe('what automations look for', () => {
  it('offers each way of matching with what it means', () => {
    expect(matchItems.map((item) => item.title)).toEqual(['Exactly', 'Starts with', 'Contains'])
    expect(matchItems[2]!.props.subtitle).toContain('has this in it')
  })

  it('compares texts ignoring letter case and extra spaces', () => {
    expect(keyOf('  Whole   FOODS ')).toBe('whole foods')
  })

  it.each([
    ['any', '5.00', '1.00', '2.00', null, null],
    ['exactly', '5.00', '1.00', '2.00', '5.00', '5.00'],
    ['between', '5.00', '1.00', '2.00', '1.00', '2.00'],
    ['between', null, null, '2.00', null, '2.00'],
  ] as const)('limits %s amounts', (mode, exact, from, to, min, max) => {
    expect(amountLimits(mode, exact, from, to)).toEqual({ min, max })
  })

  it.each([
    [null, null, 'any'],
    ['5.00', '5.00', 'exactly'],
    ['5.00', null, 'between'],
    [null, '9.00', 'between'],
    ['5.00', '9.00', 'between'],
  ] as const)('reads the limits %s and %s as %s', (min, max, mode) => {
    expect(amountMode(min, max)).toBe(mode)
  })

  it.each([
    [null, null, 'any', null, null, null],
    ['5.00', '5.00', 'exactly', '5.00', null, null],
    ['5.00', '9.00', 'between', null, '5.00', '9.00'],
    [null, '9.00', 'between', null, null, '9.00'],
  ] as const)('fills in the form for the limits %s and %s', (min, max, mode, exact, from, to) => {
    expect(amountFields(min, max)).toEqual({
      amountMode: mode,
      amountExact: exact,
      amountFrom: from,
      amountTo: to,
    })
  })

  it.each([
    ['any', null, null, null, true],
    ['exactly', null, null, null, false],
    ['exactly', '0.00', null, null, false],
    ['exactly', '5.00', null, null, true],
    ['between', null, null, null, false],
    ['between', null, '1.00', null, true],
    ['between', null, null, '9.00', true],
    ['between', null, '1.00', '9.00', true],
    ['between', null, '9.00', '1.00', false],
  ] as const)('checks %s amounts %s %s %s', (mode, exact, from, to, valid) => {
    expect(amountsValid(mode, exact, from, to)).toBe(valid)
  })

  it('names an automation after what it looks for', () => {
    expect(nameFor([])).toBe('')
    expect(nameFor(['Netflix'])).toBe('Netflix')
    expect(nameFor(['Netflix', 'Hulu', 'Max'])).toBe('Netflix and 2 more')
    expect(nameFor(['x'.repeat(200)])).toHaveLength(120)
  })

  it('finds the range of amounts whichever way the money went', () => {
    expect(amountRange([])).toBeNull()
    expect(amountRange(['-88.10', '142.30', '-96.40'])).toEqual({ min: '88.10', max: '142.30' })
    expect(amountRange(['-5.00'])).toEqual({ min: '5.00', max: '5.00' })
  })

  it.each([
    [null, null, null],
    ['2.99', '2.99', 'exactly $2.99'],
    ['80.00', '150.00', '$80.00 to $150.00'],
    ['5.00', null, 'at least $5.00'],
    [null, '9.00', 'up to $9.00'],
  ] as const)('says how much %s to %s is for', (min, max, phrase) => {
    expect(amountPhrase({ min, max }, (amount) => `$${amount}`)).toBe(phrase)
  })
})
