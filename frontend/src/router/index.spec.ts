import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'

import { saveOnboardingStep } from '@/auth/onboarding'
import { navItems } from '@/navigation'
import { HOME, buildRouter, routes, safeRedirect } from '@/router'
import { makeSessionState, signedOutState } from '@/test/fixtures'
import { useSession } from '@/test/mount'

async function visit(path: string, session: Parameters<typeof useSession>[0] = makeSessionState()) {
  setActivePinia(createPinia())
  useSession(session)
  const router = buildRouter(createMemoryHistory())
  await router.push(path)
  return router.currentRoute.value
}

describe('router', () => {
  it('redirects the root to Accounts', async () => {
    expect((await visit('/')).name).toBe('accounts')
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
    expect(loaders).toHaveLength(navItems.length + 5)
    const modules = await Promise.all(loaders.map((load) => load()))
    for (const module of modules) expect(module).toHaveProperty('default')
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
