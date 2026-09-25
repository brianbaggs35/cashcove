import { flushPromises } from '@vue/test-utils'

import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import * as password from '@/auth/password'
import * as passkeys from '@/auth/passkeys'
import SecureAccountStep from '@/components/auth/SecureAccountStep.vue'
import { notices } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { makeSessionState, makeUser, signedOutState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import InviteView from '@/views/auth/InviteView.vue'

const preview: authApi.InvitationPreview = {
  household_name: 'The Coves',
  name: 'Sam Lee',
  email: 'sam@example.com',
  role: 'viewer',
  invited_by: 'Alex Morgan',
  expires_at: '2026-10-02T12:00:00Z',
}

async function render(hash = '#invite-token', session = signedOutState()) {
  window.history.replaceState(null, '', `/invite${hash}`)
  vi.spyOn(password, 'estimateStrength').mockResolvedValue({
    score: 4,
    warning: null,
    suggestions: [],
  })
  vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(true)
  const mounted = await mountWithPlugins(InviteView, { route: `/invite${hash}`, session })
  await flushPromises()
  return mounted
}

type Wrapper = Awaited<ReturnType<typeof render>>['wrapper']

async function fill(wrapper: Wrapper, name: string, value: string) {
  await wrapper.find('[data-test="invite-name"] input').setValue(name)
  await wrapper.find('[data-test="invite-password"] input').setValue(value)
}

describe('InviteView', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('says so when the link has no token', async () => {
    const { wrapper } = await render('')
    expect(wrapper.find('[data-test="invite-problem"]').text()).toContain(
      "This invitation link isn't complete.",
    )
  })

  it('explains a link that no longer works', async () => {
    vi.spyOn(authApi, 'previewInvitation').mockRejectedValue(
      new ApiError(400, 'This invitation has expired.', { code: 'invalid_link' }),
    )
    const { wrapper } = await render()
    expect(wrapper.find('[data-test="invite-problem"]').text()).toContain(
      'This invitation has expired.',
    )
  })

  it('shows a loader while checking the link', async () => {
    vi.spyOn(authApi, 'previewInvitation').mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await render()
    expect(wrapper.find('[data-test="invite-loading"]').exists()).toBe(true)
  })

  it('creates the account, offers to secure it, then opens the app', async () => {
    const previewInvite = vi.spyOn(authApi, 'previewInvitation').mockResolvedValue(preview)
    const accept = vi.spyOn(authApi, 'acceptInvitation').mockResolvedValue(
      makeSessionState({
        user: makeUser({ name: 'Sam Lee', email: 'sam@example.com', role: 'viewer' }),
      }),
    )
    const { wrapper, router } = await render()
    expect(previewInvite).toHaveBeenCalledWith('invite-token')
    expect(window.location.hash).toBe('')
    const form = wrapper.find('[data-test="invite-form"]')
    expect(form.find('h1').text()).toBe('Join The Coves')
    expect(form.text()).toContain('Alex Morgan invited you')
    expect(form.find('[data-test="invite-email"]').text()).toBe('sam@example.com')
    expect(form.find('[data-test="role-viewer"]').exists()).toBe(true)
    expect(
      (wrapper.find('[data-test="invite-name"] input').element as HTMLInputElement).value,
    ).toBe('Sam Lee')

    await fill(wrapper, '  Sam  ', 'violet harbor compass 58')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(accept).toHaveBeenCalledWith('invite-token', 'Sam', 'violet harbor compass 58')
    expect(useAuthStore().user?.email).toBe('sam@example.com')
    expect(wrapper.find('[data-test="invite-secure"] h1').text()).toBe("You're in, Sam")

    wrapper.findComponent(SecureAccountStep).vm.$emit('continue')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('accounts')
    })
    expect(notices.value.at(-1)?.text).toBe('Welcome to The Coves!')
  })

  it('names nobody when the admin who invited them is gone', async () => {
    vi.spyOn(authApi, 'previewInvitation').mockResolvedValue({ ...preview, invited_by: null })
    const { wrapper } = await render()
    expect(wrapper.text()).toContain('An admin invited you')
  })

  it('needs a name and a password', async () => {
    vi.spyOn(authApi, 'previewInvitation').mockResolvedValue(preview)
    const { wrapper } = await render()
    const submit = () => wrapper.find('[data-test="invite-submit"]')
    expect(submit().attributes('disabled')).toBeDefined()
    await fill(wrapper, '   ', 'violet harbor compass 58')
    await flushPromises()
    expect(submit().attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Tell us your name')
    await fill(wrapper, 'Sam', 'violet harbor compass 58')
    expect(submit().attributes('disabled')).toBeUndefined()
  })

  it('shows why the account could not be created', async () => {
    vi.spyOn(authApi, 'previewInvitation').mockResolvedValue(preview)
    vi.spyOn(authApi, 'acceptInvitation').mockRejectedValue(
      new ApiError(400, 'This password is on a list of common passwords.', {
        code: 'weak_password',
      }),
    )
    const { wrapper } = await render()
    await fill(wrapper, 'Sam', 'password1234')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-test="invite-error"]').text()).toContain('common passwords')
  })

  it('greets someone who gave no name', async () => {
    vi.spyOn(authApi, 'previewInvitation').mockResolvedValue(preview)
    vi.spyOn(authApi, 'acceptInvitation').mockResolvedValue(makeSessionState())
    const { wrapper } = await render()
    await fill(wrapper, 'Sam', 'violet harbor compass 58')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-test="invite-secure"]').exists()).toBe(true)
    // Names are required, but the greeting copes without one.
    ;(wrapper.vm as unknown as { name: string }).name = ''
    await flushPromises()
    expect(wrapper.find('[data-test="invite-secure"] h1').text()).toBe("You're in")
  })

  it('asks someone already signed in to sign out first', async () => {
    vi.spyOn(authApi, 'previewInvitation').mockResolvedValue(preview)
    const signOut = vi.spyOn(authApi, 'signOut').mockResolvedValue(undefined)
    const { wrapper } = await render('#invite-token', makeSessionState())
    const notice = wrapper.find('[data-test="invite-signed-in"]')
    expect(notice.text()).toContain("You're signed in as alex@example.com")
    expect(wrapper.find('form').exists()).toBe(false)
    await notice.find('button').trigger('click')
    await flushPromises()
    expect(signOut).toHaveBeenCalledOnce()
    expect(wrapper.find('form').exists()).toBe(true)
    // Invitations are public, so signing out here stays on the page.
    expect(wrapper.find('[data-test="invite-form"]').exists()).toBe(true)
  })
})
