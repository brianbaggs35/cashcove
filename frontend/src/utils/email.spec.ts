import { isEmail } from '@/utils/email'

describe('isEmail', () => {
  it.each(['alex@example.com', ' alex.morgan+money@mail.example.co.uk ', 'a@b.c'])(
    'accepts %s',
    (value) => {
      expect(isEmail(value)).toBe(true)
    },
  )

  it.each([
    '',
    'alex',
    'alex@',
    'alex@example',
    '@example.com',
    'alex@@example.com',
    'alex morgan@example.com',
    'alex@example..com',
    'alex@.example.com',
    'alex@example.com.',
  ])('rejects %j', (value) => {
    expect(isEmail(value)).toBe(false)
  })

  it('stays fast on long near-misses', () => {
    const started = performance.now()
    expect(isEmail(`a@${'b.'.repeat(50_000)}@`)).toBe(false)
    expect(isEmail(`${'a'.repeat(100_000)}@`)).toBe(false)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
