import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import { ApiError } from '@/api/client'
import AuthenticatorSetup from '@/components/auth/AuthenticatorSetup.vue'
import { useAuthStore } from '@/stores/auth'
import { stubClipboard } from '@/test/dom'
import { makeSessionState, signedOutState } from '@/test/fixtures'
import { mountWithPlugins, type MountOptions } from '@/test/mount'

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const setup = (expiresIn = 600_000): account.TotpSetup => ({
  secret: SECRET,
  uri: `otpauth://totp/Cashcove:alex%40example.com?secret=${SECRET}&issuer=Cashcove`,
  expires_at: new Date(Date.now() + expiresIn).toISOString(),
})
const codes = Array.from({ length: 10 }, (_, index) => `code-${index}`)

async function render(options: MountOptions = {}) {
  const mounted = await mountWithPlugins(AuthenticatorSetup, { width: 1280, ...options })
  await flushPromises()
  return mounted
}

describe('AuthenticatorSetup', () => {
  it('shows a QR code, then the recovery codes once a code is confirmed', async () => {
    vi.spyOn(account, 'startTotpSetup').mockResolvedValue(setup())
    const confirm = vi.spyOn(account, 'confirmTotpSetup').mockResolvedValue({ codes })
    const { wrapper } = await render({ props: { doneText: 'Continue' } })
    expect(wrapper.find('[data-test="qr-code"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="authenticator-open"]').exists()).toBe(false)

    await wrapper.find('input.v-otp-input__input').setValue('123456')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith('123456')
    expect(useAuthStore().user).toMatchObject({ totp_enabled: true, recovery_codes_left: 10 })
    expect(wrapper.findAll('[data-test="recovery-codes"] li')).toHaveLength(10)

    const done = wrapper.find('[data-test="authenticator-done"]')
    expect(done.text()).toBe('Continue')
    expect(done.attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="codes-saved"] input').setValue(true)
    await wrapper.find('[data-test="authenticator-done"]').trigger('click')
    expect(wrapper.emitted('finished')).toHaveLength(1)
  })

  it('shows the key for typing in, in groups of four', async () => {
    stubClipboard()
    vi.spyOn(account, 'startTotpSetup').mockResolvedValue(setup())
    const { wrapper } = await render()
    const toggle = wrapper.find('[data-test="authenticator-show-key"]')
    await toggle.trigger('click')
    expect(wrapper.find('[data-test="authenticator-key-value"]').text()).toBe(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    )
    expect(toggle.text()).toBe('Hide the key')
    await toggle.trigger('click')
    expect(wrapper.find('[data-test="authenticator-key"]').exists()).toBe(false)
  })

  it('offers to open the authenticator app on phones', async () => {
    const started = setup()
    vi.spyOn(account, 'startTotpSetup').mockResolvedValue(started)
    const { wrapper } = await render({ width: 390 })
    expect(wrapper.find('[data-test="authenticator-open"]').attributes('href')).toBe(started.uri)
  })

  it('clears a wrong code so it can be typed again', async () => {
    vi.spyOn(account, 'startTotpSetup').mockResolvedValue(setup())
    vi.spyOn(account, 'confirmTotpSetup').mockRejectedValue(
      new ApiError(400, "That code didn't match.", { code: 'wrong_code' }),
    )
    const { wrapper } = await render()
    const input = () => wrapper.find('input.v-otp-input__input')
    await input().setValue('111111')
    await flushPromises()
    expect(wrapper.find('[data-test="authenticator-error"]').text()).toBe("That code didn't match.")
    expect((input().element as HTMLInputElement).value).toBe('')
  })

  it('explains a QR code that could not be made, and tries again', async () => {
    const start = vi
      .spyOn(account, 'startTotpSetup')
      .mockRejectedValueOnce(new ApiError(0, "Can't reach Cashcove.", { code: 'offline' }))
      .mockResolvedValue(setup())
    const { wrapper } = await render()
    expect(wrapper.text()).toContain("Couldn't get a QR code.")
    expect(wrapper.find('[data-test="authenticator-error"]').text()).toBe("Can't reach Cashcove.")
    expect(wrapper.find('input.v-otp-input__input').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('cancelled')).toBeUndefined()
    await wrapper.find('[data-test="authenticator-restart"]').trigger('click')
    await flushPromises()
    expect(start).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="qr-code"]').exists()).toBe(true)
  })

  it('shows a loader while getting the QR code', async () => {
    vi.spyOn(account, 'startTotpSetup').mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await render()
    expect(wrapper.find('.v-skeleton-loader').exists()).toBe(true)
  })

  it('asks for a new QR code once it expires', async () => {
    vi.spyOn(account, 'startTotpSetup').mockResolvedValue(setup(-1000))
    const { wrapper } = await render()
    expect(wrapper.text()).toContain('This QR code has expired.')
    expect(wrapper.find('input.v-otp-input__input').attributes('disabled')).toBeDefined()
  })

  it('gives up quietly when the person does not confirm it is them', async () => {
    vi.spyOn(account, 'startTotpSetup').mockRejectedValue(
      new ApiError(403, 'Confirm it is you.', { code: 'verification_required' }),
    )
    const { wrapper } = await render()
    expect(wrapper.emitted('cancelled')).toHaveLength(1)
  })

  it('still shows the codes if the session ended meanwhile', async () => {
    vi.spyOn(account, 'startTotpSetup').mockResolvedValue(setup())
    vi.spyOn(account, 'confirmTotpSetup').mockResolvedValue({ codes })
    const { wrapper } = await render({ session: makeSessionState() })
    useAuthStore().apply(signedOutState())
    await wrapper.find('input.v-otp-input__input').setValue('123456')
    await flushPromises()
    expect(wrapper.find('[data-test="recovery-codes"]').exists()).toBe(true)
  })
})
