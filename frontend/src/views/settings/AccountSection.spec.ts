import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import { ApiError } from '@/api/client'
import * as password from '@/auth/password'
import * as passkeys from '@/auth/passkeys'
import { notices } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { makeSessionState, makeUser, signedOutState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import AccountSection from '@/views/settings/AccountSection.vue'

async function render(user = makeUser()) {
  vi.spyOn(password, 'estimateStrength').mockResolvedValue({
    score: 4,
    warning: null,
    suggestions: [],
  })
  vi.spyOn(passkeys, 'signalUserDetails').mockResolvedValue(undefined)
  const mounted = await mountWithPlugins(AccountSection, { session: makeSessionState({ user }) })
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  const input = (selector: string) => find(selector).find('input')
  const value = (selector: string) => (input(selector).element as HTMLInputElement).value
  return { ...mounted, find, input, value }
}

type View = Awaited<ReturnType<typeof render>>

async function saveProfile(view: View) {
  view.find('profile-save').element.closest('form')!.dispatchEvent(new Event('submit'))
  await flushPromises()
}

async function changePasswordForm(view: View, current: string, next: string) {
  await view.input('current-password').setValue(current)
  await view.input('new-password').setValue(next)
  await flushPromises()
}

async function submitPassword(view: View) {
  view.find('password-save').element.closest('form')!.dispatchEvent(new Event('submit'))
  await flushPromises()
}

describe('AccountSection', () => {
  describe('profile', () => {
    it('shows who you are and what your role lets you do', async () => {
      const view = await render()
      expect(view.value('profile-name')).toBe('Alex Morgan')
      expect(view.value('profile-email')).toBe('alex@example.com')
      expect(view.find('account-role-summary').text()).toContain(
        'As an admin, you can change anything',
      )
      expect(view.find('account-role-summary').text()).toContain('Member since Jan 15, 2026.')
      expect(view.find('profile-reset').exists()).toBe(false)
      expect(view.find('profile-save').attributes('disabled')).toBeDefined()

      const viewer = await render(makeUser({ role: 'viewer' }))
      expect(viewer.find('account-role-summary').text()).toContain(
        'As a viewer, you can see everything',
      )
    })

    it('saves a new name', async () => {
      const update = vi
        .spyOn(account, 'updateProfile')
        .mockResolvedValue(makeUser({ name: 'Alex M' }))
      const view = await render()
      await view.input('profile-name').setValue('  Alex M ')
      expect(view.find('profile-email').text()).toContain('You sign in with this email.')
      await saveProfile(view)
      expect(update).toHaveBeenCalledWith('Alex M', 'alex@example.com')
      expect(useAuthStore().user?.name).toBe('Alex M')
      expect(view.value('profile-name')).toBe('Alex M')
      expect(notices.value.at(-1)?.text).toBe('Profile saved')
      // Without passkeys there is nothing to tell the password manager.
      expect(passkeys.signalUserDetails).not.toHaveBeenCalled()
    })

    it('saves a new email, and tells the password manager', async () => {
      vi.spyOn(account, 'updateProfile').mockResolvedValue(
        makeUser({ email: 'alex@cove.example', passkey_count: 1 }),
      )
      const view = await render(makeUser({ passkey_count: 1 }))
      await view.input('profile-email').setValue('Alex@Cove.example')
      expect(view.find('profile-email').text()).toContain("You'll confirm it's you")
      await saveProfile(view)
      expect(notices.value.at(-1)?.text).toBe('Saved. From now on, sign in with alex@cove.example.')
      expect(passkeys.signalUserDetails).toHaveBeenCalledWith(
        window.location.origin,
        'webauthn-alex',
        'alex@cove.example',
        'Alex Morgan',
      )
    })

    it('checks the name and email before saving', async () => {
      const update = vi.spyOn(account, 'updateProfile')
      const view = await render()
      await view.input('profile-name').setValue('  ')
      await flushPromises()
      expect(view.find('profile-name').text()).toContain('Enter your name')
      await view.input('profile-name').setValue('x'.repeat(81))
      await flushPromises()
      expect(view.find('profile-name').text()).toContain('Keep it under 80 characters')
      await view.input('profile-name').setValue('Alex')
      await view.input('profile-email').setValue('not-an-email')
      await flushPromises()
      expect(view.find('profile-email').text()).toContain('Enter a valid email address')
      expect(view.find('profile-save').attributes('disabled')).toBeDefined()
      await saveProfile(view)
      expect(update).not.toHaveBeenCalled()
    })

    it('does not send a form without changes', async () => {
      const update = vi.spyOn(account, 'updateProfile')
      const view = await render()
      await saveProfile(view)
      expect(update).not.toHaveBeenCalled()
    })

    it('undoes changes', async () => {
      const view = await render()
      await view.input('profile-name').setValue('Someone else')
      await view.find('profile-reset').trigger('click')
      expect(view.value('profile-name')).toBe('Alex Morgan')
    })

    it.each([
      [
        new ApiError(409, 'Someone already uses that email.', { code: 'email_taken' }),
        'profile-email',
      ],
      [
        new ApiError(422, 'Enter a valid email address.', {
          code: 'invalid',
          fields: { email: 'Enter a valid email address.' },
        }),
        'profile-email',
      ],
      [
        new ApiError(422, 'This is too long.', {
          code: 'invalid',
          fields: { name: 'This is too long.' },
        }),
        'profile-name',
      ],
    ])('shows %s by its field', async (error, field) => {
      vi.spyOn(account, 'updateProfile').mockRejectedValue(error)
      const view = await render()
      await view.input('profile-name').setValue('Alex M')
      await view.input('profile-email').setValue('sam@example.com')
      await saveProfile(view)
      expect(view.find(field).text()).toContain(error.message)
      expect(view.find('profile-error').exists()).toBe(false)
    })

    it('shows other errors under the form', async () => {
      vi.spyOn(account, 'updateProfile').mockRejectedValue(new Error('Offline.'))
      const view = await render()
      await view.input('profile-name').setValue('Alex M')
      await saveProfile(view)
      expect(view.find('profile-error').text()).toBe('Offline.')
    })

    it('follows the account unless there are unsaved edits', async () => {
      const view = await render()
      const auth = useAuthStore()
      auth.updateUser({ name: 'Alex Updated' })
      await flushPromises()
      expect(view.value('profile-name')).toBe('Alex Updated')
      await view.input('profile-name').setValue('My edit')
      auth.updateUser({ passkey_count: 3 })
      await flushPromises()
      expect(view.value('profile-name')).toBe('My edit')
    })

    it('keeps an edited email when the account changes', async () => {
      const view = await render()
      await view.input('profile-email').setValue('new@example.com')
      useAuthStore().updateUser({ passkey_count: 3 })
      await flushPromises()
      expect(view.value('profile-email')).toBe('new@example.com')
    })

    it('shows nothing without an account', async () => {
      const { wrapper } = await mountWithPlugins(AccountSection, { session: signedOutState() })
      expect(wrapper.text()).toBe('')
    })

    it('clears the form when the person signs out', async () => {
      const view = await render()
      useAuthStore().forget('signed_out')
      await flushPromises()
      expect(view.wrapper.text()).toBe('')
    })
  })

  describe('password', () => {
    it('changes the password', async () => {
      const change = vi.spyOn(account, 'changePassword').mockResolvedValue(undefined)
      const view = await render()
      expect(view.find('password-save').attributes('disabled')).toBeDefined()
      await changePasswordForm(view, 'old password here', 'violet harbor compass 58')
      await submitPassword(view)
      expect(change).toHaveBeenCalledWith('old password here', 'violet harbor compass 58')
      expect(view.value('current-password')).toBe('')
      expect(view.value('new-password')).toBe('')
      expect(notices.value.at(-1)?.text).toContain(
        'other devices you were signed in on have been signed out',
      )
    })

    it('needs a new password that is different and strong enough', async () => {
      const change = vi.spyOn(account, 'changePassword')
      const view = await render()
      await changePasswordForm(view, 'violet harbor compass', 'violet harbor compass')
      expect(view.find('new-password').text()).toContain(
        'Choose a password different from your current one.',
      )
      await submitPassword(view)
      await changePasswordForm(view, 'old password here', 'alexmorgan123')
      expect(view.find('password-save').attributes('disabled')).toBeDefined()
      await changePasswordForm(view, '', 'violet harbor compass 58')
      expect(view.find('password-save').attributes('disabled')).toBeDefined()
      expect(change).not.toHaveBeenCalled()
    })

    it.each([
      [
        new ApiError(401, 'Your current password is wrong.', { code: 'wrong_password' }),
        'current-password',
      ],
      [
        new ApiError(422, 'This is required.', {
          code: 'invalid',
          fields: { current_password: 'This is required.' },
        }),
        'current-password',
      ],
      [
        new ApiError(400, 'This password is on a list of common passwords.', {
          code: 'weak_password',
        }),
        'new-password',
      ],
      [
        new ApiError(422, 'This is too long.', {
          code: 'invalid',
          fields: { new_password: 'This is too long.' },
        }),
        'new-password',
      ],
    ])('shows %s by its field', async (error, field) => {
      vi.spyOn(account, 'changePassword').mockRejectedValue(error)
      const view = await render()
      await changePasswordForm(view, 'old password here', 'violet harbor compass 58')
      await submitPassword(view)
      expect(view.find(field).text()).toContain(error.message)
      expect(view.find('password-error').exists()).toBe(false)
    })

    it('shows other errors under the form', async () => {
      vi.spyOn(account, 'changePassword').mockRejectedValue(new Error('Offline.'))
      const view = await render()
      await changePasswordForm(view, 'old password here', 'violet harbor compass 58')
      await submitPassword(view)
      expect(view.find('password-error').text()).toBe('Offline.')
    })
  })
})
