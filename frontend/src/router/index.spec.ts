import { createMemoryHistory } from 'vue-router'

import { navItems } from '@/navigation'
import { buildRouter, routes } from '@/router'

describe('router', () => {
  it('redirects the root to Accounts', async () => {
    const router = buildRouter(createMemoryHistory())
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('accounts')
  })

  it.each(navItems.map((item) => [item.path, item.title]))(
    'loads %s and titles the page %s',
    async (path, title) => {
      const router = buildRouter(createMemoryHistory())
      await router.push(path)
      const record = router.currentRoute.value.matched[0]!
      expect(record.components?.default).toBeDefined()
      expect(document.title).toBe(`${title} · Cashcove`)
    },
  )

  it('lazy-loads every view module', async () => {
    const loaders = routes
      .map((route) => route.component)
      .filter((component): component is () => Promise<unknown> => typeof component === 'function')
    expect(loaders).toHaveLength(navItems.length + 1)
    const modules = await Promise.all(loaders.map((load) => load()))
    for (const module of modules) expect(module).toHaveProperty('default')
  })

  it('shows the not-found page for unknown paths', async () => {
    const router = buildRouter(createMemoryHistory())
    await router.push('/does/not/exist')
    expect(router.currentRoute.value.name).toBe('not-found')
    expect(document.title).toBe('Page not found · Cashcove')
  })

  it('uses browser history by default', () => {
    expect(buildRouter().options.history.base).toBe('')
  })
})
