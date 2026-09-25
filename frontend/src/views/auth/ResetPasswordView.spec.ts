import { flushPromises } from '@vue/test-utils'

import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import * as password from '@/auth/password'
import { notices } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { makeSessionState, makeUser, signedOutState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import ResetPasswordView from '@/views/auth/ResetPasswordView.vue'

const preview: authApi.PasswordResetPreview = {
  name: 'Sam Lee',
  email: 'sam@example.com',
  expires_at: '2026-09-26T13:39:00Z',
}

async function render(hash = '#reset-token', session = signedOutState()) {
  window.history.replaceState(null, '', `/reset-password${hash}`)
  vi.spyOn(password, 'estimateStrength').mockResolvedValue({
    score: 4,
    warning: null,
    suggestions: [],
  })
  const mounted = await mountWithPlugins(ResetPasswordView, {
    route: `/reset-password${hash}`,
    session,
  })
  await flushPromises()
  return mounted
}

async function choose(wrapper: Awaited<ReturnType<typeof render>>['wrapper'], value: string) {
  await wrapper.find('[data-test="reset-password"] input').setValue(value)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('ResetPasswordView', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('says so when the link has no token', async () => {
    const previewReset = vi.spyOn(authApi, 'previewPasswordReset')
    const { wrapper } = await render('')
    expect(wrapper.find('[data-test="reset-problem"]').text()).toContain(
      "This reset link isn't complete.",
    )
    expect(previewReset).not.toHaveBeenCalled()
  })

  it('explains a link that has expired or was used', async () => {
    vi.spyOn(authApi, 'previewPasswordReset').mockRejectedValue(
      new ApiError(400, 'This link has expired. Ask an admin for a new one.', {
        code: 'invalid_link',
      }),
    )
    const { wrapper } = await render()
    expect(wrapper.find('[data-test="reset-problem"]').text()).toContain('This link has expired.')
  })

  it('shows a loader while checking the link', async () => {
    vi.spyOn(authApi, 'previewPasswordReset').mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await render()
    expect(wrapper.find('[data-test="reset-loading"]').exists()).toBe(true)
  })

  it('changes the password and asks the person to sign in with it', async () => {
    const previewReset = vi.spyOn(authApi, 'previewPasswordReset').mockResolvedValue(preview)
    const complete = vi.spyOn(authApi, 'completePasswordReset').mockResolvedValue(undefined)
    const { wrapper, router } = await render()
    expect(previewReset).toHaveBeenCalledWith('reset-token')
    // The token leaves the address bar as soon as the page reads it.
    expect(window.location.hash).toBe('')
    expect(wrapper.find('[data-test="reset-email"]').text()).toBe('sam@example.com')
    expect(wrapper.find('[data-test="reset-submit"]').attributes('disabled')).toBeDefined()
    await choose(wrapper, 'violet harbor compass 58')
    expect(complete).toHaveBeenCalledWith('reset-token', 'violet harbor compass 58')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('sign-in')
    })
    expect(router.currentRoute.value.query).toEqual({ email: 'sam@example.com' })
    expect(useAuthStore().signedOutReason).toBe('password_reset')
  })

  it('signs out the person whose password changed', async () => {
    vi.spyOn(authApi, 'previewPasswordReset').mockResolvedValue(preview)
    vi.spyOn(authApi, 'completePasswordReset').mockResolvedValue(undefined)
    const session = makeSessionState({ user: makeUser({ email: 'sam@example.com' }) })
    const { wrapper, router } = await render('#reset-token', session)
    await choose(wrapper, 'violet harbor compass 58')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('sign-in')
    })
    expect(useAuthStore().signedIn).toBe(false)
  })

  it('keeps someone else signed in, e.g. an admin trying the link', async () => {
    vi.spyOn(authApi, 'previewPasswordReset').mockResolvedValue(preview)
    vi.spyOn(authApi, 'completePasswordReset').mockResolvedValue(undefined)
    const { wrapper, router } = await render('#reset-token', makeSessionState())
    await choose(wrapper, 'violet harbor compass 58')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('accounts')
    })
    expect(useAuthStore().signedIn).toBe(true)
    expect(notices.value.at(-1)?.text).toBe('Password changed for sam@example.com.')
  })

  it('shows why a password was not accepted', async () => {
    vi.spyOn(authApi, 'previewPasswordReset').mockResolvedValue(preview)
    vi.spyOn(authApi, 'completePasswordReset').mockRejectedValue(
      new ApiError(400, 'This password is on a list of common passwords.', {
        code: 'weak_password',
      }),
    )
    const { wrapper } = await render()
    await choose(wrapper, 'password1234')
    expect(wrapper.find('[data-test="reset-error"]').text()).toContain('common passwords')
  })
})
