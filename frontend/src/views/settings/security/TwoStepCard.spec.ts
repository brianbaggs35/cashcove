import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import AuthenticatorSetup from '@/components/auth/AuthenticatorSetup.vue'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { click, page } from '@/test/dom'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import TwoStepCard from '@/views/settings/security/TwoStepCard.vue'

async function render(changes: Parameters<typeof makeUser>[0] = {}) {
  const user = makeUser(changes)
  const mounted = await mountWithPlugins(TwoStepCard, {
    props: { user },
    session: makeSessionState({ user }),
    width: 1280,
  })
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  return { ...mounted, find }
}

const setupDialog = () => page().find('.v-overlay--active [data-test="authenticator-setup"]')

describe('TwoStepCard', () => {
  beforeEach(() => {
    // The setup itself is AuthenticatorSetup's to test; here it just waits.
    vi.spyOn(account, 'startTotpSetup').mockReturnValue(new Promise(() => undefined))
  })

  it('offers to set up an authenticator app', async () => {
    const { find, wrapper } = await render()
    expect(find('two-step-status').text()).toBe('Off')
    expect(find('recovery-codes-left').exists()).toBe(false)
    await find('two-step-setup').trigger('click')
    await flushPromises()
    const setup = wrapper.findComponent(AuthenticatorSetup)
    expect(setup.exists()).toBe(true)
    expect(page().find('.v-overlay--active').text()).toContain('Set up an authenticator app')

    setup.vm.$emit('finished')
    await flushPromises()
    expect(wrapper.findComponent(AuthenticatorSetup).exists()).toBe(false)
    expect(notices.value.at(-1)?.text).toBe('Two-step verification is on')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('closes the setup when it is cancelled or closed', async () => {
    const { find, wrapper } = await render()
    await find('two-step-setup').trigger('click')
    await flushPromises()
    wrapper.findComponent(AuthenticatorSetup).vm.$emit('cancelled')
    await flushPromises()
    expect(wrapper.findComponent(AuthenticatorSetup).exists()).toBe(false)

    await find('two-step-setup').trigger('click')
    await flushPromises()
    await click('.v-overlay--active [data-test="dialog-close"]')
    await flushPromises()
    expect(wrapper.findComponent(AuthenticatorSetup).exists()).toBe(false)
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(setupDialog().exists()).toBe(false)
  })

  it.each([
    [10, '10 recovery codes left', false],
    [3, '3 recovery codes left', true],
    [1, '1 recovery code left', true],
  ])('counts %i recovery codes left', async (left, text, low) => {
    const { find } = await render({ totp_enabled: true, recovery_codes_left: left })
    expect(find('two-step-status').text()).toBe('On')
    expect(find('recovery-codes-left').text()).toBe(text)
    expect(find('recovery-codes-low').exists()).toBe(low)
    expect(find('two-step-setup').exists()).toBe(false)
  })

  it('turns off two-step verification once confirmed', async () => {
    const turnOff = vi.spyOn(account, 'turnOffTotp').mockResolvedValue(undefined)
    const { find, wrapper } = await render({ totp_enabled: true, recovery_codes_left: 8 })
    await find('two-step-off').trigger('click')
    expect(confirmRequest.value?.title).toBe('Turn off two-step verification?')
    confirmRequest.value!.resolve(false)
    await flushPromises()
    expect(wrapper.emitted('changed')).toBeUndefined()

    await find('two-step-off').trigger('click')
    await confirmRequest.value!.action!()
    confirmRequest.value!.resolve(true)
    await flushPromises()
    expect(turnOff).toHaveBeenCalledOnce()
    expect(useAuthStore().user).toMatchObject({ totp_enabled: false, recovery_codes_left: 0 })
    expect(notices.value.at(-1)).toMatchObject({
      text: 'Two-step verification is off',
      tone: 'info',
    })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('replaces the recovery codes and shows the new ones until they are saved', async () => {
    const codes = Array.from({ length: 10 }, (_, index) => `new-${index}`)
    vi.spyOn(account, 'createRecoveryCodes').mockResolvedValue({ codes })
    const { find, wrapper } = await render({ totp_enabled: true, recovery_codes_left: 2 })
    await find('recovery-codes-new').trigger('click')
    expect(confirmRequest.value?.title).toBe('Create new recovery codes?')
    confirmRequest.value!.resolve(false)
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="recovery-codes"]').exists()).toBe(false)

    await find('recovery-codes-new').trigger('click')
    await confirmRequest.value!.action!()
    confirmRequest.value!.resolve(true)
    await flushPromises()
    const dialog = page().find('.v-overlay--active')
    expect(dialog.findAll('[data-test="recovery-codes"] li').map((item) => item.text())).toEqual(
      codes,
    )
    expect(dialog.find('[data-test="dialog-close"]').exists()).toBe(false)
    expect(useAuthStore().user?.recovery_codes_left).toBe(10)
    expect(wrapper.emitted('changed')).toHaveLength(1)

    const done = () => page().find('.v-overlay--active [data-test="new-codes-done"]')
    expect(done().attributes('disabled')).toBeDefined()
    await page().find('.v-overlay--active [data-test="new-codes-saved"] input').setValue(true)
    await done().trigger('click')
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="recovery-codes"]').exists()).toBe(false)
  })
})
