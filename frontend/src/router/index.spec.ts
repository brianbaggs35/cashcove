import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

import { saveOnboardingStep } from '@/auth/onboarding'
import { navItems } from '@/navigation'
import { HOME, buildRouter, routes, safeRedirect } from '@/router'
import { makeSessionState, makeUser, signedOutState } from '@/test/fixtures'
import { useSession } from '@/test/mount'

async function visit(path: string, session: Parameters<typeof useSession>[0] = makeSessionState()) {
  setActivePinia(createPinia())
  useSession(session)
  const router = buildRouter(createMemoryHistory())
  await router.push(path)
  return router.currentRoute.value
}

describe('router', () => {
  it('redirects the root to the Dashboard', async () => {
    expect((await visit('/')).name).toBe('dashboard')
  })

  it.each(navItems.map((item) => [item.path, item.title]))(
    'loads %s and titles the page %s',
    async (path, title) => {
      const route = await visit(path)
      expect(route.matched[0]!.components?.default).toBeDefined()
      expect(document.title).toBe(`${title} · Cashcove`)
    },
  )

  it('lazy-loads every view module', async () => {
    const loaders = routes
      .map((route) => route.component)
      .filter((component): component is () => Promise<unknown> => typeof component === 'function')
    // The tabs, the pages for one subscription or bill, and the pages outside the app.
    expect(loaders).toHaveLength(navItems.length + 2 + 5)
    const modules = await Promise.all(loaders.map((load) => load()))
    for (const module of modules) expect(module).toHaveProperty('default')
  })

  it.each([
    ['subscription', '/subscriptions', 'Subscription'],
    ['bill', '/bills', 'Bill'],
  ] as const)('opens one %s at its own address, within its tab', async (kind, tab, title) => {
    const route = await visit(`${tab}/0b3f6a52-8a9f-4c5e-9d3f-6f7a4c1d2e90`)

    expect(route.name).toBe(kind)
    expect(route.params.id).toBe('0b3f6a52-8a9f-4c5e-9d3f-6f7a4c1d2e90')
    expect(document.title).toBe(`${title} · Cashcove`)
    // Which tab to light in the navigation, whichever it is of.
    expect(route.meta.nav).toBe(kind === 'bill' ? 'bills' : 'subscriptions')
    // The page is told which it is and which one, so the same page serves both.
    const record = route.matched[0]!
    const props = record.props.default as (route: unknown) => unknown
    expect(props(route)).toEqual({ kind, id: '0b3f6a52-8a9f-4c5e-9d3f-6f7a4c1d2e90' })
  })

  it('keeps the list of each at the address the tab has, and the pages for one apart from it', async () => {
    expect((await visit('/bills')).name).toBe('bills')
    expect((await visit('/subscriptions')).name).toBe('subscriptions')
    expect((await visit('/bills')).meta.nav).toBeUndefined()
  })

  it('lets any signed-in person open one, but not someone signed out', async () => {
    const id = '0b3f6a52-8a9f-4c5e-9d3f-6f7a4c1d2e90'
    expect(
      (await visit(`/bills/${id}`, makeSessionState({ user: makeUser({ role: 'viewer' }) }))).name,
    ).toBe('bill')
    const signedOut = await visit(`/bills/${id}`, signedOutState())
    expect(signedOut.name).toBe('sign-in')
    expect(signedOut.query.redirect).toBe(`/bills/${id}`)
  })

  it('sends the old Settings address for categories to the Categories tab', async () => {
    const route = await visit('/settings/categories')
    expect(route.name).toBe('categories')
    expect(route.fullPath).toBe('/categories')
  })

  it('opens Connect when a bank sends people back from its own sign-in page', async () => {
    const route = await visit('/connect/oauth?oauth_state_id=abc')
    expect(route.name).toBe('connect')
    expect(route.path).toBe('/connect/oauth')
    expect(document.title).toBe('Connect · Cashcove')
  })

  it('shows the not-found page for unknown paths', async () => {
    expect((await visit('/does/not/exist')).name).toBe('not-found')
    expect(document.title).toBe('Page not found · Cashcove')
  })

  it('uses browser history by default', () => {
    expect(buildRouter().options.history.base).toBe('')
  })

  it('still shows the page when the session cannot be loaded', async () => {
    const route = await visit('/budget', 'unreachable')
    expect(route.name).toBe('budget')
  })
})

describe('access', () => {
  it('sends everyone to the welcome wizard until Cashcove is set up', async () => {
    const setup = signedOutState({ setup_required: true })
    expect((await visit('/accounts', setup)).name).toBe('welcome')
    expect((await visit('/sign-in', setup)).name).toBe('welcome')
    expect((await visit('/welcome', setup)).name).toBe('welcome')
  })

  it('keeps the new admin in the wizard only while it has steps left', async () => {
    expect((await visit('/welcome')).fullPath).toBe(HOME)
    saveOnboardingStep('household')
    expect((await visit('/welcome')).name).toBe('welcome')
  })

  it('sends signed-out people from the wizard to sign in', async () => {
    expect((await visit('/welcome', signedOutState())).name).toBe('sign-in')
  })

  it('lets anyone open invitation and reset links', async () => {
    expect((await visit('/invite', signedOutState())).name).toBe('invite')
    expect((await visit('/reset-password')).name).toBe('reset-password')
  })

  it('shows sign-in only to signed-out people', async () => {
    expect((await visit('/sign-in', signedOutState())).name).toBe('sign-in')
    expect((await visit('/sign-in')).fullPath).toBe(HOME)
    expect((await visit('/sign-in?redirect=/budget')).fullPath).toBe('/budget')
  })

  it('asks signed-out people to sign in, coming back afterwards', async () => {
    const route = await visit('/settings/users', signedOutState())
    expect(route.name).toBe('sign-in')
    expect(route.query).toEqual({ redirect: '/settings/users' })
    const home = await visit(HOME, signedOutState())
    expect(home.name).toBe('sign-in')
    expect(home.query).toEqual({})
  })
})

describe('admin pages', () => {
  const viewer = () => makeSessionState({ user: makeUser({ role: 'viewer' }) })

  it('are for admins, and send anyone else home', async () => {
    expect((await visit('/ai')).name).toBe('ai')
    expect((await visit('/ai/usage')).fullPath).toBe('/ai/usage')
    expect((await visit('/ai', viewer())).fullPath).toBe(HOME)
    expect((await visit('/ai/recommendations', viewer())).fullPath).toBe(HOME)
  })

  it('ask signed-out people to sign in first, coming back afterwards', async () => {
    const route = await visit('/ai', signedOutState())
    expect(route.name).toBe('sign-in')
    expect(route.query).toEqual({ redirect: '/ai' })
  })

  it('leave every other tab open to viewers', async () => {
    const others = navItems.filter((item) => !item.admin)
    expect(others.length).toBeGreaterThan(0)
    for (const item of others) {
      expect((await visit(item.path, viewer())).fullPath).toBe(item.path)
    }
  })
})

describe('safeRedirect', () => {
  it.each([
    ['/budget', '/budget'],
    ['/settings/users?tab=1', '/settings/users?tab=1'],
    ['//evil.example', HOME],
    ['/\\evil.example', HOME],
    ['https://evil.example', HOME],
    ['budget', HOME],
    [undefined, HOME],
    [['/budget'], HOME],
  ])('treats %j as %s', (value, expected) => {
    expect(safeRedirect(value)).toBe(expected)
  })
})
