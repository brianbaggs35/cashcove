import * as account from '@/api/account'
import { ApiError } from '@/api/client'
import * as flows from '@/auth/passkeyFlows'
import * as passkeys from '@/auth/passkeys'
import VerifyIdentityHost from '@/components/auth/VerifyIdentityHost.vue'
import { requestVerification } from '@/composables/verification'
import { click, page } from '@/test/dom'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { flushPromises, mountWithPlugins } from '@/test/mount'

async function render(user = makeUser()) {
  const mounted = await mountWithPlugins(VerifyIdentityHost, {
    session: makeSessionState({ user }),
  })
  const answer = requestVerification()
  await flushPromises()
  return { ...mounted, answer }
}

async function typeInto(selector: string, value: string) {
  await page().find(selector).setValue(value)
}

const wrongPassword = new ApiError(401, 'That password is wrong.', { code: 'wrong_password' })

describe('VerifyIdentityHost', () => {
  it('confirms with a password', async () => {
    const verify = vi.spyOn(account, 'verifyWithPassword').mockResolvedValue(undefined)
    const { answer } = await render()
    expect(page().find('.v-overlay--active h2').text()).toBe("Confirm it's you")
    expect(page().find('[data-test="verify-passkey"]').exists()).toBe(false)
    expect(page().find('[data-test="verify-switch"]').exists()).toBe(false)
    expect(page().find('[data-test="verify-confirm"]').attributes('disabled')).toBeDefined()
    await typeInto('[data-test="verify-password"] input', 'violet harbor compass')
    await click('[data-test="verify-confirm"]')
    await expect(answer).resolves.toBe(true)
    expect(verify).toHaveBeenCalledWith('violet harbor compass')
  })

  it('shows a wrong password and lets the person try again with Enter', async () => {
    const verify = vi
      .spyOn(account, 'verifyWithPassword')
      .mockRejectedValueOnce(wrongPassword)
      .mockResolvedValue(undefined)
    const { answer } = await render()
    await typeInto('[data-test="verify-password"] input', 'wrong password')
    await page().find('.v-overlay--active form').trigger('submit')
    await flushPromises()
    expect(page().find('[data-test="verify-error"]').text()).toBe('That password is wrong.')
    await page().find('.v-overlay--active form').trigger('submit')
    await expect(answer).resolves.toBe(true)
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('does nothing on Enter without a password', async () => {
    const verify = vi.spyOn(account, 'verifyWithPassword')
    await render()
    await page().find('.v-overlay--active form').trigger('submit')
    expect(verify).not.toHaveBeenCalled()
  })

  it('confirms with an authenticator code, clearing a wrong one', async () => {
    const verify = vi
      .spyOn(account, 'verifyWithTotp')
      .mockRejectedValueOnce(new ApiError(401, 'That code is wrong.', { code: 'wrong_code' }))
      .mockResolvedValue(undefined)
    const { answer } = await render(makeUser({ totp_enabled: true }))
    await click('[data-test="verify-switch"]')
    expect(page().find('[data-test="verify-switch"]').text()).toBe('Use your password instead')
    expect(page().find('[data-test="verify-confirm"]').attributes('disabled')).toBeDefined()
    const code = () => page().find('.v-overlay--active input.v-otp-input__input')
    await code().setValue('111111')
    await flushPromises()
    expect(page().find('[data-test="verify-error"]').text()).toBe('That code is wrong.')
    expect((code().element as HTMLInputElement).value).toBe('')

    // A short code isn't sent; a full one is.
    await code().setValue('123')
    await page().find('.v-overlay--active form').trigger('submit')
    expect(verify).toHaveBeenCalledOnce()
    await code().setValue('123456')
    await expect(answer).resolves.toBe(true)
    expect(verify).toHaveBeenLastCalledWith('123456')
  })

  it('switches back to the password', async () => {
    await render(makeUser({ totp_enabled: true }))
    await click('[data-test="verify-switch"]')
    await click('[data-test="verify-switch"]')
    expect(page().find('[data-test="verify-password"]').exists()).toBe(true)
    expect(page().find('[data-test="verify-switch"]').text()).toBe(
      'Use an authenticator code instead',
    )
  })

  it('submits a full code with Enter too', async () => {
    const verify = vi.spyOn(account, 'verifyWithTotp').mockReturnValue(new Promise(() => undefined))
    await render(makeUser({ totp_enabled: true }))
    await click('[data-test="verify-switch"]')
    await page().find('.v-overlay--active input.v-otp-input__input').setValue('123456')
    await flushPromises()
    await page().find('.v-overlay--active form').trigger('submit')
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('confirms with a passkey', async () => {
    vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(true)
    const answerWithPasskey = vi.spyOn(flows, 'answerWithPasskey').mockResolvedValue(undefined)
    const { answer } = await render(makeUser({ passkey_count: 1 }))
    await click('[data-test="verify-passkey"]')
    await expect(answer).resolves.toBe(true)
    expect(answerWithPasskey).toHaveBeenCalledWith(
      account.verifyWithPasskeyOptions,
      account.verifyWithPasskey,
    )
  })

  it('stays open when the passkey prompt is closed, or fails', async () => {
    vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(true)
    const answerWithPasskey = vi
      .spyOn(flows, 'answerWithPasskey')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new flows.PasskeyError(new Error('broken')))
    await render(makeUser({ passkey_count: 2 }))
    await click('[data-test="verify-passkey"]')
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="verify-error"]').exists()).toBe(false)
    await click('[data-test="verify-passkey"]')
    await flushPromises()
    expect(page().find('[data-test="verify-error"]').text()).toContain("couldn't use a passkey")
    expect(answerWithPasskey).toHaveBeenCalledTimes(2)
  })

  it('reports cancelling, or closing the dialog', async () => {
    const { answer } = await render()
    await click('[data-test="verify-cancel"]')
    await expect(answer).resolves.toBe(false)

    const again = requestVerification()
    await flushPromises()
    await click('.v-overlay--active [data-test="dialog-close"]')
    await expect(again).resolves.toBe(false)
  })

  it('starts fresh each time it opens', async () => {
    vi.spyOn(account, 'verifyWithPassword').mockRejectedValue(wrongPassword)
    const { answer } = await render(makeUser({ totp_enabled: true }))
    await typeInto('[data-test="verify-password"] input', 'wrong password')
    await click('[data-test="verify-confirm"]')
    await flushPromises()
    await click('[data-test="verify-switch"]')
    await click('[data-test="verify-cancel"]')
    await answer
    void requestVerification()
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="verify-error"]').exists()).toBe(false)
    expect(
      (page().find('[data-test="verify-password"] input').element as HTMLInputElement).value,
    ).toBe('')
  })
})
