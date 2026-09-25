import { makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import SecuritySummary from '@/views/settings/security/SecuritySummary.vue'

async function render(changes: Parameters<typeof makeUser>[0] = {}) {
  const mounted = await mountWithPlugins(SecuritySummary, {
    route: '/settings/security',
    props: { user: makeUser(changes) },
  })
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  return { ...mounted, find }
}

describe('SecuritySummary', () => {
  it('warns when only a password protects the account', async () => {
    const { wrapper, find } = await render()
    expect(find('security-summary-title').text()).toBe('Only your password protects your account')
    expect(wrapper.classes()).toContain('security-summary--warning')
    expect(find('security-check-password-done').exists()).toBe(true)
    expect(find('security-check-passkeys').text()).toContain('Add one')
    expect(find('security-check-passkeys-todo').exists()).toBe(true)
    expect(find('security-check-app').text()).toContain('Off')
    expect(find('security-check-app-todo').exists()).toBe(true)
  })

  it.each([
    [{ passkey_count: 1 }, 'primary', 'Passkeys keep signing in safe and quick', '1 saved', 'Off'],
    [
      { passkey_count: 3, totp_enabled: true },
      'success',
      'Your account is well protected',
      '3 saved',
      'On',
    ],
    [{ totp_enabled: true }, 'success', 'Your account is well protected', 'Add one', 'On'],
  ])('sums up %j', async (changes, tone, title, passkeys, app) => {
    const { wrapper, find } = await render(changes)
    expect(find('security-summary-title').text()).toBe(title)
    expect(wrapper.classes()).toContain(`security-summary--${tone}`)
    expect(find('security-check-passkeys').text()).toContain(passkeys)
    expect(find('security-check-app').text()).toContain(app)
  })

  it('suggests a passkey to someone with only an authenticator app', async () => {
    const { wrapper } = await render({ totp_enabled: true })
    expect(wrapper.text()).toContain('Add a passkey for quicker sign-ins.')
    const both = await render({ totp_enabled: true, passkey_count: 1 })
    expect(both.wrapper.text()).toContain('You can sign in with a passkey')
  })

  it('jumps to each setting', async () => {
    const target = document.createElement('div')
    target.id = 'two-step'
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    document.body.appendChild(target)
    const { find, router } = await render()
    await find('security-check-app').trigger('click')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    // Nothing to scroll to is fine too.
    await find('security-check-passkeys').trigger('click')
    await find('security-check-password').trigger('click')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/settings/account')
    })
    target.remove()
  })
})
