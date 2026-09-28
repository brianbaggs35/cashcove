import {
  forgetLink,
  LINK_SCRIPT,
  linkErrorMessage,
  loadLink,
  openLink,
  rememberLink,
  takePendingLink,
  type LinkError,
  type PlaidLink,
} from '@/plaid/link'

const loginError: LinkError = {
  error_type: 'ITEM_ERROR',
  error_code: 'INVALID_CREDENTIALS',
  error_message: 'the provided credentials were not correct',
  display_message: 'The username or password was incorrect.',
}

/** A stand-in for Link: it answers `open()` with whatever the test says the person did. */
function fakePlaid(respond: (options: Parameters<PlaidLink['create']>[0]) => void) {
  const handler = { open: vi.fn(), destroy: vi.fn() }
  const create = vi.fn((options: Parameters<PlaidLink['create']>[0]) => {
    handler.open.mockImplementation(() => {
      respond(options)
    })
    return handler
  })
  window.Plaid = { create }
  return { create, handler }
}

function scripts() {
  return [...document.head.querySelectorAll(`script[src="${LINK_SCRIPT}"]`)]
}

afterEach(() => {
  delete window.Plaid
  for (const script of scripts()) script.remove()
})

describe('loadLink', () => {
  it("uses Link when it's already loaded", async () => {
    const { create } = fakePlaid(() => undefined)
    expect((await loadLink()).create).toBe(create)
    expect(scripts()).toHaveLength(0)
  })

  it("loads Plaid's script once, however many ask for it", async () => {
    const first = loadLink()
    const second = loadLink()
    expect(scripts()).toHaveLength(1)
    const script = scripts()[0] as HTMLScriptElement
    expect(script.async).toBe(true)

    const { create } = fakePlaid(() => undefined)
    script.dispatchEvent(new Event('load'))
    expect((await first).create).toBe(create)
    expect((await second).create).toBe(create)
  })

  it('fails when the script is blocked, and tries again next time', async () => {
    const loading = loadLink()
    scripts()[0]!.dispatchEvent(new Event('error'))
    await expect(loading).rejects.toThrow("Couldn't load Plaid")
    expect(scripts()).toHaveLength(0)

    const retry = loadLink()
    expect(scripts()).toHaveLength(1)
    scripts()[0]!.dispatchEvent(new Event('load'))
    await expect(retry).rejects.toThrow('cdn.plaid.com')
  })
})

describe('openLink', () => {
  it('resolves with the public token once a bank is connected, then tidies Link away', async () => {
    vi.useFakeTimers()
    const { create, handler } = fakePlaid((options) => {
      options.onSuccess('public-sandbox-1', {
        institution: { name: 'Tartan Bank', institution_id: 'ins_1' },
      })
    })

    const outcome = await openLink('link-sandbox-1')

    expect(outcome).toEqual({
      connected: true,
      publicToken: 'public-sandbox-1',
      institution: 'Tartan Bank',
    })
    expect(create.mock.lastCall![0]).not.toHaveProperty('receivedRedirectUri')
    expect(handler.destroy).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(handler.destroy).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('picks up after a bank’s own sign-in page', async () => {
    const { create } = fakePlaid((options) => {
      options.onSuccess('public-sandbox-1', { institution: null })
    })
    const outcome = await openLink('link-sandbox-1', 'https://cashcove.test/connect/oauth?x=1')
    expect(outcome).toEqual({ connected: true, publicToken: 'public-sandbox-1', institution: null })
    expect(create.mock.lastCall![0].receivedRedirectUri).toBe(
      'https://cashcove.test/connect/oauth?x=1',
    )
  })

  it('resolves with why Link closed without a bank', async () => {
    fakePlaid((options) => {
      options.onExit(loginError)
    })
    expect(await openLink('link-sandbox-1')).toEqual({ connected: false, error: loginError })
  })
})

describe('pending links', () => {
  const pending = {
    token: 'link-sandbox-1',
    purpose: 'connect' as const,
    connectionId: null,
    historyDays: 365 as const,
  }

  it('are kept for this tab until taken, once', () => {
    rememberLink(pending)
    expect(takePendingLink()).toEqual(pending)
    expect(takePendingLink()).toBeNull()
  })

  it('can be forgotten', () => {
    rememberLink({ ...pending, purpose: 'reconnect', connectionId: 'connection-1' })
    forgetLink()
    expect(takePendingLink()).toBeNull()
  })

  it.each([
    ['not JSON', '{'],
    ['not an object', '"link"'],
    ['null', 'null'],
    ['missing its token', JSON.stringify({ ...pending, token: 1 })],
    ['for something else', JSON.stringify({ ...pending, purpose: 'pay' })],
    ['with an odd connection', JSON.stringify({ ...pending, connectionId: 7 })],
  ])('ignores what was kept when it is %s', (_, saved) => {
    sessionStorage.setItem('cashcove.pendingLink', saved)
    expect(takePendingLink()).toBeNull()
  })

  it('carry on without storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => {
      rememberLink(pending)
    }).not.toThrow()
    expect(() => {
      forgetLink()
    }).not.toThrow()
    expect(takePendingLink()).toBeNull()
  })
})

describe('linkErrorMessage', () => {
  it("uses Plaid's words for people, or says what failed", () => {
    expect(linkErrorMessage(loginError)).toBe('The username or password was incorrect.')
    expect(linkErrorMessage({ ...loginError, display_message: null })).toBe(
      "Plaid couldn't connect the bank (INVALID_CREDENTIALS). Try again, or try another bank.",
    )
  })
})
