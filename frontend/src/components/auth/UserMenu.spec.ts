import * as authApi from '@/api/auth'
import UserMenu from '@/components/auth/UserMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { click, page } from '@/test/dom'
import { makeSessionState, makeUser, signedOutState } from '@/test/fixtures'
import { flushPromises, mountWithPlugins } from '@/test/mount'

describe('UserMenu', () => {
  it('shows who is signed in, with links to their settings', async () => {
    const { wrapper } = await mountWithPlugins(UserMenu, {
      session: makeSessionState({ user: makeUser({ role: 'viewer' }) }),
    })
    const button = wrapper.find('[data-test="user-menu"]')
    expect(button.attributes('aria-label')).toBe('Account menu for Alex Morgan')
    await button.trigger('click')
    await flushPromises()
    const menu = page().find('.v-overlay--active')
    expect(menu.text()).toContain('Alex Morgan')
    expect(menu.text()).toContain('alex@example.com')
    expect(menu.find('[data-test="role-viewer"]').exists()).toBe(true)
    expect(menu.find('[data-test="menu-account"]').attributes('href')).toBe('/settings/account')
    expect(menu.find('[data-test="menu-security"]').attributes('href')).toBe('/settings/security')
  })

  it('signs out', async () => {
    const signOut = vi.spyOn(authApi, 'signOut').mockResolvedValue(undefined)
    const { wrapper } = await mountWithPlugins(UserMenu)
    await wrapper.find('[data-test="user-menu"]').trigger('click')
    await flushPromises()
    await click('[data-test="menu-sign-out"]')
    await flushPromises()
    expect(signOut).toHaveBeenCalledOnce()
    expect(useAuthStore().signedIn).toBe(false)
  })

  it('is not there for someone signed out', async () => {
    const { wrapper } = await mountWithPlugins(UserMenu, { session: signedOutState() })
    expect(wrapper.find('[data-test="user-menu"]').exists()).toBe(false)
  })
})
