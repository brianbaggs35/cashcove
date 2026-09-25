import { takeLinkToken } from '@/utils/linkToken'

describe('takeLinkToken', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('reads the token after # and removes it from the address bar', () => {
    window.history.replaceState({ kept: true }, '', '/invite?from=text#abc%20123')
    expect(takeLinkToken()).toBe('abc 123')
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/invite?from=text',
    )
    expect(window.history.state).toEqual({ kept: true })
  })

  it('returns nothing when there is no token', () => {
    window.history.replaceState(null, '', '/invite')
    expect(takeLinkToken()).toBe('')
  })

  it('returns nothing for a token that is not valid', () => {
    window.history.replaceState(null, '', '/invite#%E0%A4%A')
    expect(takeLinkToken()).toBe('')
    expect(window.location.hash).toBe('')
  })
})
