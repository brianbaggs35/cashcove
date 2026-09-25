import AppShell from '@/layouts/AppShell.vue'
import { makeSessionState, makeUser, signedOutState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import { greeting } from '@/utils/format'

describe('AppShell', () => {
  it('greets the person by first name', async () => {
    const { wrapper } = await mountWithPlugins(AppShell, {
      route: '/accounts',
      width: 1920,
      withApp: true,
      session: makeSessionState({ user: makeUser({ name: 'Sam de la Cruz' }) }),
    })
    expect(wrapper.find('[data-test="app-greeting"]').text()).toContain(
      `${greeting(new Date())}, Sam`,
    )
  })

  it('greets without a name when nobody is signed in', async () => {
    const { wrapper } = await mountWithPlugins(AppShell, {
      route: '/accounts',
      width: 1920,
      withApp: true,
      session: signedOutState(),
    })
    const text = wrapper.find('[data-test="app-greeting"] .text-title-medium').text()
    expect(text).toBe(greeting(new Date()))
  })
})
