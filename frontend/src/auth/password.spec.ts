import { MAX_LENGTH, MIN_LENGTH, estimateStrength, passwordProblem } from '@/auth/password'

describe('passwordProblem', () => {
  it.each([
    ['short', `Use at least ${MIN_LENGTH} characters.`],
    ['x'.repeat(MAX_LENGTH + 1), `Use at most ${MAX_LENGTH} characters.`],
    ['abababababababab', 'Use more than a few different characters.'],
    ['cashcove2026!', 'Too much of this password is your name, email address or Cashcove.'],
    ['violet harbor compass', null],
  ])('%j → %s', (password, problem) => {
    expect(passwordProblem(password)).toBe(problem)
  })

  it('counts characters as people see them', () => {
    // Eleven emoji are 22 UTF-16 units but still too short.
    expect(passwordProblem('🌊'.repeat(11))).toBe(`Use at least ${MIN_LENGTH} characters.`)
  })

  it("rejects passwords made of the person's name or email", () => {
    const context = { name: 'Alex Morgan', email: 'alexmorgan@example.com' }
    expect(passwordProblem('alexmorgan123', context)).toMatch(/your name/)
    expect(passwordProblem('Morgan Alex 12', context)).toMatch(/your name/)
    expect(passwordProblem('violet harbor compass', context)).toBeNull()
  })

  it('ignores very short name parts', () => {
    expect(passwordProblem('jo violet harbor', { name: 'Jo' })).toBeNull()
  })
})

describe('estimateStrength', () => {
  it('scores guessable and strong passwords, with advice', async () => {
    const weak = await estimateStrength('password1234')
    expect(weak.score).toBeLessThan(2)
    expect(weak.warning).not.toBeNull()
    const strong = await estimateStrength('violet harbor compass 58')
    expect(strong.score).toBe(4)
    expect(strong.suggestions).toEqual([])
  }, 20_000)

  it("counts the person's own details as easy to guess", async () => {
    const context = { name: 'Zephyrine Quillfeather', email: 'zq@example.com' }
    const plain = await estimateStrength('zephyrinequillfeather')
    const known = await estimateStrength('zephyrinequillfeather', context)
    expect(known.score).toBeLessThanOrEqual(plain.score)
    expect(known.score).toBeLessThan(3)
  }, 20_000)
})
