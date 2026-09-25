import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import { ApiError } from '@/api/client'
import * as flows from '@/auth/passkeyFlows'
import * as passkeys from '@/auth/passkeys'
import AuthenticatorSetup from '@/components/auth/AuthenticatorSetup.vue'
import SecureAccountStep from '@/components/auth/SecureAccountStep.vue'
import { useAuthStore } from '@/stores/auth'
import { makePasskey, makeSessionState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'

async function render({ passkeysWork = true } = {}) {
  vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(passkeysWork)
  vi.spyOn(account, 'startTotpSetup').mockResolvedValue({
    secret: 'JBSWY3DPEHPK3PXP',
    uri: 'otpauth://totp/Cashcove?secret=JBSWY3DPEHPK3PXP',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  })
  const mounted = await mountWithPlugins(SecureAccountStep, { session: makeSessionState() })
  await flushPromises()
  return mounted
}

describe('SecureAccountStep', () => {
  it('offers a passkey and an authenticator app, and can be skipped', async () => {
    const { wrapper } = await render()
    expect(wrapper.find('[data-test="secure-passkey"]').text()).toContain('Recommended')
    expect(wrapper.find('[data-test="secure-app"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('You can add these any time in Settings.')
    await wrapper.find('[data-test="secure-skip"]').trigger('click')
    expect(wrapper.emitted('continue')).toHaveLength(1)
  })

  it('leaves out passkeys where they cannot work', async () => {
    const { wrapper } = await render({ passkeysWork: false })
    expect(wrapper.find('[data-test="secure-passkey"]').exists()).toBe(false)
  })

  it('adds a passkey', async () => {
    const add = vi
      .spyOn(flows, 'addPasskeyToAccount')
      .mockResolvedValueOnce(null)
      .mockResolvedValue(makePasskey({ name: 'iCloud Keychain' }))
    const { wrapper } = await render()
    // Closing the prompt changes nothing.
    await wrapper.find('[data-test="secure-add-passkey"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="secure-passkey-done"]').exists()).toBe(false)

    await wrapper.find('[data-test="secure-add-passkey"]').trigger('click')
    await flushPromises()
    expect(add).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="secure-passkey-done"]').text()).toContain(
      'Added iCloud Keychain',
    )
    await wrapper.find('[data-test="secure-continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toHaveLength(1)
  })

  it('explains a passkey that could not be added', async () => {
    vi.spyOn(flows, 'addPasskeyToAccount').mockRejectedValue(
      new ApiError(400, 'This device already has a passkey for Cashcove.'),
    )
    const { wrapper } = await render()
    await wrapper.find('[data-test="secure-add-passkey"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="secure-passkey"] .v-alert').text()).toContain(
      'already has a passkey',
    )
  })

  it('sets up an authenticator app, and can go back', async () => {
    const { wrapper } = await render()
    await wrapper.find('[data-test="secure-setup-app"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="secure-app-setup"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="secure-app"]').exists()).toBe(false)
    await wrapper.find('[data-test="secure-app-back"]').trigger('click')
    expect(wrapper.find('[data-test="secure-app"]').exists()).toBe(true)
  })

  it('keeps the recovery codes on screen until they are saved', async () => {
    const { wrapper } = await render()
    await wrapper.find('[data-test="secure-setup-app"]').trigger('click')
    await flushPromises()
    // Confirming the code turns two-step verification on; the codes show next.
    useAuthStore().updateUser({ totp_enabled: true })
    await flushPromises()
    expect(wrapper.find('[data-test="secure-app-setup"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="secure-app-back"]').exists()).toBe(false)

    wrapper.findComponent(AuthenticatorSetup).vm.$emit('finished')
    await flushPromises()
    expect(wrapper.find('[data-test="secure-app-done"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="secure-continue"]').exists()).toBe(true)
  })

  it('goes back when the person does not confirm it is them', async () => {
    const { wrapper } = await render()
    await wrapper.find('[data-test="secure-setup-app"]').trigger('click')
    await flushPromises()
    wrapper.findComponent(AuthenticatorSetup).vm.$emit('cancelled')
    await flushPromises()
    expect(wrapper.find('[data-test="secure-app"]').exists()).toBe(true)
  })
})
