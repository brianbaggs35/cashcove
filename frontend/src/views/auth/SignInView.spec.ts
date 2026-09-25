import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import * as flows from '@/auth/passkeyFlows'
import * as passkeys from '@/auth/passkeys'
import { notices } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { page } from '@/test/dom'
import { makePasskey, makeSessionState, signedOutState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import SignInView from '@/views/auth/SignInView.vue'

const signedIn = (): authApi.SignInResult => ({
  status: 'signed_in',
  state: makeSessionState(),
  methods: [],
})
const needsCode = (
  methods: authApi.TwoFactorMethod[] = ['totp', 'recovery_code'],
): authApi.SignInResult => ({
  status: 'two_factor_required',
  state: null,
  methods,
})
const wrongPassword = () =>
  new ApiError(401, 'That email or password is wrong.', { code: 'invalid_credentials' })
const tooMany = (seconds = 30) =>
  new ApiError(429, 'Too many attempts.', {
    code: 'too_many_attempts',
    data: { retry_after: seconds },
  })
const credential = { id: 'credential-1' } as AuthenticationResponseJSON

interface Options {
  passkeysWork?: boolean
  autofill?: boolean
  path?: string
  reason?: 'signed_out' | 'expired' | 'password_reset'
}

async function render({
  passkeysWork = false,
  autofill = false,
  path = '/sign-in',
  reason,
}: Options = {}) {
  vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(passkeysWork)
  vi.spyOn(passkeys, 'browserHasPasskeyAutofill').mockResolvedValue(autofill)
  vi.spyOn(passkeys, 'browserCanUpgradeToPasskey').mockResolvedValue(false)
  vi.spyOn(passkeys, 'signalCurrentPasskeys').mockResolvedValue(undefined)
  vi.spyOn(passkeys, 'signalRemovedPasskey').mockResolvedValue(undefined)
  vi.spyOn(passkeys, 'cancelPasskeyPrompt').mockReturnValue(undefined)
  vi.spyOn(account, 'fetchPasskeys').mockResolvedValue([])
  const mounted = await mountWithPlugins(SignInView, {
    route: path,
    session: signedOutState(),
    beforeMount: () => {
      if (reason) useAuthStore().signedOutReason = reason
    },
  })
  await flushPromises()
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  return { ...mounted, find }
}

type View = Awaited<ReturnType<typeof render>>

async function enter(view: View, email: string, password: string) {
  await view.find('sign-in-email').find('input').setValue(email)
  await view.find('sign-in-password').find('input').setValue(password)
}

async function submit(view: View) {
  await view.wrapper.find('form').trigger('submit')
  await flushPromises()
}

async function landed(view: View, name = 'accounts') {
  await vi.waitFor(() => {
    expect(view.router.currentRoute.value.name).toBe(name)
  })
}

describe('SignInView', () => {
  describe('with a password', () => {
    it('signs in and opens the app', async () => {
      const signIn = vi.spyOn(authApi, 'signIn').mockResolvedValue(signedIn())
      const view = await render()
      expect(view.find('sign-in-passkey').exists()).toBe(false)
      expect(view.find('sign-in-notice').exists()).toBe(false)
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await view.find('sign-in-remember').find('input').setValue(true)
      expect(view.wrapper.text()).toContain("Only use this on a device that's just yours.")
      await submit(view)
      expect(signIn).toHaveBeenCalledWith('alex@example.com', 'violet harbor compass', true)
      expect(useAuthStore().signedIn).toBe(true)
      await landed(view)
    })

    it('goes back to the page that asked for sign-in, but only within Cashcove', async () => {
      vi.spyOn(authApi, 'signIn').mockResolvedValue(signedIn())
      const view = await render({ path: '/sign-in?redirect=/budget' })
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await landed(view, 'budget')
    })

    it('fills in the email from the link', async () => {
      const view = await render({ path: '/sign-in?email=sam@example.com' })
      expect((view.find('sign-in-email').find('input').element as HTMLInputElement).value).toBe(
        'sam@example.com',
      )
    })

    it('needs an email and a password', async () => {
      const signIn = vi.spyOn(authApi, 'signIn')
      const view = await render()
      expect(view.find('sign-in-submit').attributes('disabled')).toBeDefined()
      await submit(view)
      await view.find('sign-in-email').find('input').setValue('alex@example.com')
      await submit(view)
      expect(signIn).not.toHaveBeenCalled()
    })

    it('shows a wrong password', async () => {
      vi.spyOn(authApi, 'signIn').mockRejectedValue(wrongPassword())
      const view = await render({ reason: 'signed_out' })
      expect(view.find('sign-in-notice').text()).toContain("You've signed out.")
      await enter(view, 'alex@example.com', 'wrong password')
      await submit(view)
      expect(view.find('sign-in-error').text()).toBe('That email or password is wrong.')
      // The error replaces the notice.
      expect(view.find('sign-in-notice').exists()).toBe(false)
    })

    it('reports errors that did not come from Cashcove', async () => {
      vi.spyOn(authApi, 'signIn').mockRejectedValue(new Error('Something broke.'))
      const view = await render()
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      expect(view.find('sign-in-error').text()).toBe('Something broke.')
    })

    it('pauses signing in after too many attempts, counting down', async () => {
      const signIn = vi.spyOn(authApi, 'signIn').mockRejectedValue(tooMany(2))
      const view = await render()
      await enter(view, 'alex@example.com', 'wrong password')
      await submit(view)
      expect(view.find('sign-in-error').text()).toBe('Too many attempts. Try again in 2 seconds.')
      expect(view.find('sign-in-submit').attributes('disabled')).toBeDefined()
      await submit(view)
      expect(signIn).toHaveBeenCalledOnce()
      await vi.waitFor(
        () => {
          expect(view.find('sign-in-error').text()).toBe('Too many attempts.')
        },
        {
          timeout: 4000,
        },
      )
      expect(view.find('sign-in-submit').attributes('disabled')).toBeUndefined()
    })

    it('ignores a second attempt while the first is still going', async () => {
      const signIn = vi.spyOn(authApi, 'signIn').mockReturnValue(new Promise(() => undefined))
      const view = await render({ passkeysWork: true })
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await submit(view)
      expect(signIn).toHaveBeenCalledOnce()
      // Signing in with a passkey waits too.
      expect(view.find('sign-in-passkey').attributes('disabled')).toBeDefined()
    })

    it('copes with a sign-in that returns no session', async () => {
      vi.spyOn(authApi, 'signIn').mockResolvedValue({
        status: 'signed_in',
        state: null,
        methods: [],
      })
      const view = await render()
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      expect(useAuthStore().signedIn).toBe(false)
    })

    it.each([
      ['expired', 'Your session ended.'],
      ['password_reset', 'Your password was changed.'],
    ] as const)('explains why the person is here (%s)', async (reason, text) => {
      const view = await render({ reason })
      expect(view.find('sign-in-notice').text()).toContain(text)
    })

    it('explains how to reset a forgotten password', async () => {
      const view = await render()
      await view.find('sign-in-forgot').trigger('click')
      await flushPromises()
      expect(page().find('.v-overlay--active pre').text()).toBe(
        'make reset-link EMAIL=you@example.com',
      )
      await view.find('sign-in-email').find('input').setValue('sam@example.com')
      expect(page().find('.v-overlay--active pre').text()).toBe(
        'make reset-link EMAIL=sam@example.com',
      )
      await page().find('.v-overlay--active .app-dialog__actions button').trigger('click')
      expect(view.wrapper.findComponent({ name: 'VDialog' }).props('modelValue')).toBe(false)
      // It closes from its corner button too.
      await view.find('sign-in-forgot').trigger('click')
      await flushPromises()
      await page().find('.v-overlay--active [data-test="dialog-close"]').trigger('click')
      expect(view.wrapper.findComponent({ name: 'VDialog' }).props('modelValue')).toBe(false)
    })
  })

  describe('after signing in', () => {
    beforeEach(() => vi.spyOn(authApi, 'signIn').mockResolvedValue(signedIn()))

    it('tells the password manager which passkeys are current', async () => {
      const view = await render({ passkeysWork: true })
      vi.mocked(account.fetchPasskeys).mockResolvedValue([makePasskey()])
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await vi.waitFor(() => {
        expect(passkeys.signalCurrentPasskeys).toHaveBeenCalledWith(
          window.location.origin,
          'webauthn-alex',
          ['credential-1'],
        )
      })
      expect(passkeys.browserCanUpgradeToPasskey).not.toHaveBeenCalled()
    })

    it('has the password manager save a passkey quietly where it can', async () => {
      const add = vi.spyOn(flows, 'addPasskeyToAccount').mockResolvedValue(makePasskey())
      const view = await render({ passkeysWork: true })
      vi.mocked(passkeys.browserCanUpgradeToPasskey).mockResolvedValue(true)
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await vi.waitFor(() => {
        expect(add).toHaveBeenCalledWith('', { quietly: true })
      })
      await vi.waitFor(() => {
        expect(notices.value.at(-1)?.text).toContain('Passkey saved.')
      })
    })

    it('says nothing when the password manager declines', async () => {
      const add = vi.spyOn(flows, 'addPasskeyToAccount').mockResolvedValue(null)
      const view = await render({ passkeysWork: true })
      vi.mocked(passkeys.browserCanUpgradeToPasskey).mockResolvedValue(true)
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await vi.waitFor(() => {
        expect(add).toHaveBeenCalled()
      })
      await flushPromises()
      expect(notices.value).toEqual([])
    })

    it('does not offer a passkey where the browser cannot save one quietly', async () => {
      const add = vi.spyOn(flows, 'addPasskeyToAccount')
      const view = await render({ passkeysWork: true })
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await vi.waitFor(() => {
        expect(passkeys.browserCanUpgradeToPasskey).toHaveBeenCalled()
      })
      expect(add).not.toHaveBeenCalled()
    })

    it('carries on if tidying up fails', async () => {
      const view = await render({ passkeysWork: true })
      vi.mocked(account.fetchPasskeys).mockRejectedValue(new Error('Offline.'))
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await landed(view)
    })

    it('skips it where passkeys cannot work', async () => {
      const view = await render()
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      await landed(view)
      expect(account.fetchPasskeys).not.toHaveBeenCalled()
    })
  })

  describe('with a passkey', () => {
    it('signs in with the passkey button', async () => {
      const answer = vi
        .spyOn(flows, 'answerWithPasskey')
        .mockImplementation((_, send) => send('challenge', credential))
      const signInWithPasskey = vi.spyOn(authApi, 'signInWithPasskey').mockResolvedValue(signedIn())
      const view = await render({ passkeysWork: true })
      await view.find('sign-in-passkey').trigger('click')
      await flushPromises()
      expect(answer).toHaveBeenCalledWith(authApi.passkeySignInOptions, expect.any(Function), {
        autofill: false,
      })
      expect(signInWithPasskey).toHaveBeenCalledWith('challenge', credential, false)
      await landed(view)
      // Passkey sign-ins don't offer to save another passkey.
      expect(passkeys.browserCanUpgradeToPasskey).not.toHaveBeenCalled()
    })

    it('does nothing when the prompt is closed, then offers autofill again', async () => {
      const answer = vi.spyOn(flows, 'answerWithPasskey').mockResolvedValue(null)
      const view = await render({ passkeysWork: true })
      vi.mocked(passkeys.browserHasPasskeyAutofill).mockResolvedValue(true)
      answer.mockResolvedValueOnce(null).mockReturnValue(new Promise(() => undefined))
      await view.find('sign-in-passkey').trigger('click')
      await flushPromises()
      expect(view.find('sign-in-error').exists()).toBe(false)
      expect(answer).toHaveBeenLastCalledWith(authApi.passkeySignInOptions, expect.any(Function), {
        autofill: true,
      })
    })

    it('tells the password manager about a passkey Cashcove no longer knows', async () => {
      vi.spyOn(flows, 'answerWithPasskey').mockImplementation((_, send) =>
        send('challenge', credential),
      )
      vi.spyOn(authApi, 'signInWithPasskey').mockRejectedValue(
        new ApiError(401, 'That passkey was removed.', {
          code: 'invalid_passkey',
          data: { unknown_credential: true },
        }),
      )
      const view = await render({ passkeysWork: true })
      await view.find('sign-in-passkey').trigger('click')
      await flushPromises()
      expect(passkeys.signalRemovedPasskey).toHaveBeenCalledWith(
        window.location.origin,
        'credential-1',
      )
      expect(view.find('sign-in-error').text()).toBe('That passkey was removed.')
    })

    it('shows other passkey failures', async () => {
      vi.spyOn(flows, 'answerWithPasskey').mockImplementation((_, send) =>
        send('challenge', credential),
      )
      vi.spyOn(authApi, 'signInWithPasskey').mockRejectedValue(
        new ApiError(401, 'That passkey is not valid.'),
      )
      const view = await render({ passkeysWork: true })
      await view.find('sign-in-passkey').trigger('click')
      await flushPromises()
      expect(passkeys.signalRemovedPasskey).not.toHaveBeenCalled()
      expect(view.find('sign-in-error').text()).toBe('That passkey is not valid.')
    })

    it('offers passkeys in the email field autofill', async () => {
      vi.spyOn(flows, 'answerWithPasskey').mockImplementation((_, send) =>
        send('challenge', credential),
      )
      vi.spyOn(authApi, 'signInWithPasskey').mockResolvedValue(signedIn())
      const view = await render({ passkeysWork: true, autofill: true })
      await landed(view)
      expect(flows.answerWithPasskey).toHaveBeenCalledWith(
        authApi.passkeySignInOptions,
        expect.any(Function),
        { autofill: true },
      )
    })

    it('shows what Cashcove says about an autofilled passkey, and nothing else', async () => {
      const answer = vi
        .spyOn(flows, 'answerWithPasskey')
        .mockRejectedValueOnce(new flows.PasskeyError(new Error('aborted')))
      const first = await render({ passkeysWork: true, autofill: true })
      expect(first.find('sign-in-error').exists()).toBe(false)
      first.wrapper.unmount()

      answer.mockRejectedValueOnce(new ApiError(401, 'That passkey is not valid.'))
      const second = await render({ passkeysWork: true, autofill: true })
      expect(second.find('sign-in-error').text()).toBe('That passkey is not valid.')
    })

    it('leaves autofill alone where the browser has none', async () => {
      const answer = vi.spyOn(flows, 'answerWithPasskey')
      await render({ passkeysWork: true, autofill: false })
      expect(answer).not.toHaveBeenCalled()
    })

    it('closes a waiting passkey prompt when leaving the page', async () => {
      const view = await render({ passkeysWork: true })
      view.wrapper.unmount()
      expect(passkeys.cancelPasskeyPrompt).toHaveBeenCalled()
    })

    it('waits for a password sign-in that is under way', async () => {
      vi.spyOn(authApi, 'signIn').mockReturnValue(new Promise(() => undefined))
      const view = await render({ passkeysWork: true })
      vi.spyOn(flows, 'answerWithPasskey').mockReturnValue(new Promise(() => undefined))
      await view.find('sign-in-passkey').trigger('click')
      await enter(view, 'alex@example.com', 'violet harbor compass')
      // The passkey prompt is open, so the password can't be sent meanwhile.
      expect(view.find('sign-in-submit').attributes('disabled')).toBeDefined()
    })
  })

  describe('with two-step verification', () => {
    async function atCodeStep(methods?: authApi.TwoFactorMethod[], passkeysWork = false) {
      vi.spyOn(authApi, 'signIn').mockResolvedValue(needsCode(methods))
      const view = await render({ passkeysWork })
      await enter(view, 'alex@example.com', 'violet harbor compass')
      await submit(view)
      return view
    }

    const codeInput = (view: View) => view.wrapper.find('input.v-otp-input__input')

    it('asks for a code from the authenticator app', async () => {
      const totp = vi.spyOn(authApi, 'signInWithTotp').mockResolvedValue(signedIn())
      const view = await atCodeStep()
      expect(view.find('step-totp').exists()).toBe(true)
      expect(view.find('use-passkey-instead').exists()).toBe(false)
      expect(view.find('totp-submit').attributes('disabled')).toBeDefined()
      await codeInput(view).setValue('123456')
      await flushPromises()
      expect(totp).toHaveBeenCalledWith('123456')
      await landed(view)
    })

    it('clears a wrong code, and waits for six digits', async () => {
      const totp = vi
        .spyOn(authApi, 'signInWithTotp')
        .mockRejectedValue(new ApiError(401, 'That code is wrong.', { code: 'invalid_code' }))
      const view = await atCodeStep()
      await codeInput(view).setValue('111111')
      await flushPromises()
      expect(view.find('sign-in-error').text()).toBe('That code is wrong.')
      expect((codeInput(view).element as HTMLInputElement).value).toBe('')
      await codeInput(view).setValue('12')
      await submit(view)
      expect(totp).toHaveBeenCalledOnce()
    })

    it('pauses after too many codes', async () => {
      vi.spyOn(authApi, 'signInWithTotp').mockRejectedValue(tooMany(30))
      const view = await atCodeStep()
      await codeInput(view).setValue('111111')
      await flushPromises()
      expect(view.find('sign-in-error').text()).toBe('Too many attempts. Try again in 30 seconds.')
      expect(codeInput(view).attributes('disabled')).toBeDefined()
    })

    it('starts over when the first step has expired', async () => {
      vi.spyOn(authApi, 'signInWithTotp').mockRejectedValue(
        new ApiError(401, 'That took too long. Sign in again.', { code: 'sign_in_expired' }),
      )
      const view = await atCodeStep()
      await codeInput(view).setValue('123456')
      await flushPromises()
      expect(view.find('step-credentials').exists()).toBe(true)
      expect(view.find('sign-in-error').text()).toBe('That took too long. Sign in again.')
    })

    it('can use a passkey instead, where it can work', async () => {
      const answer = vi.spyOn(flows, 'answerWithPasskey').mockResolvedValue(signedIn())
      const view = await atCodeStep(['totp', 'recovery_code', 'passkey'], true)
      await view.find('use-passkey-instead').trigger('click')
      await flushPromises()
      expect(answer).toHaveBeenCalledWith(
        authApi.secondStepPasskeyOptions,
        authApi.signInSecondStepWithPasskey,
      )
      await landed(view)
    })

    it('does not offer a passkey the account has not got', async () => {
      const view = await atCodeStep(['totp', 'recovery_code'], true)
      expect(view.find('use-passkey-instead').exists()).toBe(false)
    })

    it('signs in with a recovery code', async () => {
      const recovery = vi.spyOn(authApi, 'signInWithRecoveryCode').mockResolvedValue(signedIn())
      const view = await atCodeStep()
      await view.find('use-recovery-code').trigger('click')
      expect(view.find('step-recovery').exists()).toBe(true)
      expect(view.find('recovery-submit').attributes('disabled')).toBeDefined()
      await submit(view)
      expect(recovery).not.toHaveBeenCalled()
      await view.find('recovery-code').find('input').setValue('abcd-efgh-ijkl-mnop')
      await submit(view)
      expect(recovery).toHaveBeenCalledWith('abcd-efgh-ijkl-mnop')
      await landed(view)
    })

    it('shows a wrong recovery code, and goes back to the app', async () => {
      vi.spyOn(authApi, 'signInWithRecoveryCode').mockRejectedValue(
        new ApiError(401, 'That recovery code is wrong or was used.'),
      )
      const view = await atCodeStep()
      await view.find('use-recovery-code').trigger('click')
      await view.find('recovery-code').find('input').setValue('nope')
      await submit(view)
      expect(view.find('sign-in-error').text()).toBe('That recovery code is wrong or was used.')
      await view.find('back-to-code').trigger('click')
      expect(view.find('step-totp').exists()).toBe(true)
      expect(view.find('sign-in-error').exists()).toBe(false)
    })

    it('pauses after too many recovery codes', async () => {
      vi.spyOn(authApi, 'signInWithRecoveryCode').mockRejectedValue(tooMany(65))
      const view = await atCodeStep()
      await view.find('use-recovery-code').trigger('click')
      await view.find('recovery-code').find('input').setValue('nope')
      await submit(view)
      expect(view.find('sign-in-error').text()).toBe('Too many attempts. Try again in 1:05.')
      expect(view.find('recovery-submit').attributes('disabled')).toBeDefined()
    })

    it('starts over from the beginning', async () => {
      const view = await atCodeStep(undefined, true)
      vi.spyOn(flows, 'answerWithPasskey').mockReturnValue(new Promise(() => undefined))
      vi.mocked(passkeys.browserHasPasskeyAutofill).mockResolvedValue(true)
      await view.find('start-over').trigger('click')
      await flushPromises()
      expect(view.find('step-credentials').exists()).toBe(true)
      // The email is kept; the password was cleared when the code was asked for.
      expect((view.find('sign-in-email').find('input').element as HTMLInputElement).value).toBe(
        'alex@example.com',
      )
      expect((view.find('sign-in-password').find('input').element as HTMLInputElement).value).toBe(
        '',
      )
      expect(flows.answerWithPasskey).toHaveBeenCalledWith(
        authApi.passkeySignInOptions,
        expect.any(Function),
        { autofill: true },
      )
    })
  })
})
