import { flushPromises, type DOMWrapper } from '@vue/test-utils'

import { ApiError } from '@/api/client'
import * as users from '@/api/users'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { click, page } from '@/test/dom'
import { makeMember, makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import MembersCard from '@/views/settings/users/MembersCard.vue'

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

const alex = makeMember({
  id: 'user-alex',
  name: 'Alex Morgan',
  email: 'alex@example.com',
  role: 'admin',
  details: { totp_enabled: true, passkey_count: 2, last_sign_in_at: hoursAgo(2) },
})
const sam = makeMember()
const jo = makeMember({
  id: 'user-jo',
  name: 'Jo Park',
  email: 'jo@example.com',
  role: 'admin',
  is_active: false,
  details: { totp_enabled: false, passkey_count: 1, last_sign_in_at: null },
})
const taylor = makeMember({
  id: 'user-taylor',
  name: 'Taylor Reed',
  email: 'taylor@example.com',
  role: 'admin',
  details: { totp_enabled: true, passkey_count: 0, last_sign_in_at: hoursAgo(30) },
})

interface Options {
  members?: users.Member[]
  loaded?: boolean
  busy?: boolean
  error?: string | null
  role?: 'admin' | 'viewer'
}

async function render({
  members = [alex, sam, jo],
  loaded = true,
  busy = false,
  error = null,
  role = 'admin',
}: Options = {}) {
  const mounted = await mountWithPlugins(MembersCard, {
    width: 1280,
    props: { members, loaded, busy, error },
    session: makeSessionState({ user: makeUser({ role }) }),
  })
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  const all = (selector: string) => mounted.wrapper.findAll(`[data-test="${selector}"]`)
  return { ...mounted, find, all }
}

/** Opens the actions menu for the nth person listed. */
async function openMenu(all: (selector: string) => DOMWrapper<Element>[], index: number) {
  // Vuetify ignores a click that would reopen a menu within 50ms of it closing.
  await new Promise((resolve) => setTimeout(resolve, 60))
  await all('member-actions')[index]!.trigger('click')
  await flushPromises()
}

const item = (name: string) => page().find(`.v-overlay--active [data-test="member-${name}"]`)

async function answer(confirmed: boolean) {
  if (confirmed) await confirmRequest.value!.action!()
  confirmRequest.value!.resolve(confirmed)
  await flushPromises()
}

describe('MembersCard', () => {
  it('lists everyone, and how each of them signs in', async () => {
    const { all, find, wrapper } = await render()
    const members = all('member')
    expect(members).toHaveLength(3)
    expect(members[0]!.find('[data-test="member-you"]').exists()).toBe(true)
    expect(members[0]!.find('[data-test="role-admin"]').exists()).toBe(true)
    expect(members[0]!.find('[data-test="member-details"]').text()).toMatch(
      /2 passkeys\s*Two-step on\s*Signed in 2 hours ago/,
    )
    expect(members[1]!.find('[data-test="member-you"]').exists()).toBe(false)
    expect(members[1]!.find('[data-test="member-details"]').text()).toMatch(
      /No passkeys\s*Two-step off\s*Hasn't signed in yet/,
    )
    expect(members[2]!.find('[data-test="member-details"]').text()).toContain('1 passkey')
    expect(members[2]!.find('[data-test="member-off"]').text()).toBe('Turned off')
    expect(members[2]!.classes()).toContain('member--off')
    expect(members[2]!.findComponent(UserAvatar).props('muted')).toBe(true)
    expect(members[1]!.findComponent(UserAvatar).props('muted')).toBe(false)
    expect(members[1]!.find('[data-test="member-off"]').exists()).toBe(false)

    await find('invite-open').trigger('click')
    expect(wrapper.emitted('invite')).toHaveLength(1)
  })

  it('shows a loader, and an error that can be retried', async () => {
    const loading = await render({ members: [], loaded: false, busy: true })
    expect(loading.find('members-loading').exists()).toBe(true)

    const failed = await render({ members: [], error: "Can't reach Cashcove." })
    expect(failed.find('members-error').text()).toContain("Can't reach Cashcove.")
    await failed.find('members-retry').trigger('click')
    expect(failed.wrapper.emitted('retry')).toHaveLength(1)
  })

  it('lets viewers see people without changing anything', async () => {
    const { all, find } = await render({
      role: 'viewer',
      members: [
        { ...alex, details: null },
        { ...sam, details: null },
      ],
    })
    expect(all('member')).toHaveLength(2)
    expect(find('member-details').exists()).toBe(false)
    expect(find('invite-open').exists()).toBe(false)
    expect(find('member-actions').exists()).toBe(false)
  })

  it('keeps the only admin from stepping down', async () => {
    const { all } = await render()
    await openMenu(all, 0)
    expect(item('own-security').attributes('href')).toBe('/settings/security')
    expect(item('step-down').classes()).toContain('v-list-item--disabled')
    expect(item('step-down').text()).toContain('Make someone else an admin first')
    expect(item('make-viewer').exists()).toBe(false)
  })

  it('lets an admin step down when another admin remains', async () => {
    const update = vi.spyOn(users, 'updateMember').mockResolvedValue({ ...alex, role: 'viewer' })
    const { all, wrapper } = await render({ members: [alex, taylor] })
    await openMenu(all, 0)
    expect(item('step-down').text()).not.toContain('Make someone else')
    await item('step-down').trigger('click')
    expect(confirmRequest.value).toMatchObject({ title: 'Stop being an admin?', tone: 'warning' })
    await answer(true)
    expect(update).toHaveBeenCalledWith('user-alex', { role: 'viewer' })
    expect(useAuthStore().user?.role).toBe('viewer')
    expect(notices.value.at(-1)?.text).toBe("You're now a viewer")
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ ...alex, role: 'viewer' }])
  })

  it('makes someone an admin or a viewer', async () => {
    const update = vi
      .spyOn(users, 'updateMember')
      .mockResolvedValueOnce({ ...sam, role: 'admin' })
      .mockResolvedValueOnce({ ...taylor, role: 'viewer' })
    const { all, wrapper } = await render({ members: [alex, sam, taylor] })
    await openMenu(all, 1)
    await item('make-admin').trigger('click')
    expect(confirmRequest.value?.title).toBe('Make Sam Lee an admin?')
    await answer(false)
    expect(wrapper.emitted('updated')).toBeUndefined()

    await openMenu(all, 1)
    await item('make-admin').trigger('click')
    await answer(true)
    expect(update).toHaveBeenLastCalledWith('user-sam', { role: 'admin' })
    expect(notices.value.at(-1)?.text).toBe('Sam Lee is now an admin')
    // Someone else's role doesn't change yours.
    expect(useAuthStore().user?.role).toBe('admin')

    await openMenu(all, 2)
    await item('make-viewer').trigger('click')
    expect(confirmRequest.value?.title).toBe('Make Taylor Reed a viewer?')
    await answer(true)
    expect(update).toHaveBeenLastCalledWith('user-taylor', { role: 'viewer' })
    expect(notices.value.at(-1)?.text).toBe('Taylor Reed is now a viewer')
    expect(wrapper.emitted('updated')).toHaveLength(2)
  })

  it('turns accounts off and back on', async () => {
    const update = vi
      .spyOn(users, 'updateMember')
      .mockResolvedValueOnce({ ...sam, is_active: false })
      .mockResolvedValueOnce({ ...jo, is_active: true })
    const { all } = await render()
    await openMenu(all, 1)
    expect(item('reset-two-step').exists()).toBe(false)
    await item('turn-off').trigger('click')
    expect(confirmRequest.value?.title).toBe("Turn off Sam Lee's account?")
    await answer(true)
    expect(update).toHaveBeenLastCalledWith('user-sam', { is_active: false })
    expect(notices.value.at(-1)?.text).toBe("Sam Lee's account is off")

    await openMenu(all, 2)
    // No reset links for an account that's off.
    expect(item('reset-link').exists()).toBe(false)
    await item('turn-on').trigger('click')
    expect(confirmRequest.value?.title).toBe("Turn Jo Park's account back on?")
    await answer(true)
    expect(update).toHaveBeenLastCalledWith('user-jo', { is_active: true })
    expect(notices.value.at(-1)?.text).toBe('Jo Park can sign in again')
  })

  it('creates a password reset link to send', async () => {
    const create = vi
      .spyOn(users, 'createResetLink')
      .mockRejectedValueOnce(new ApiError(0, "Can't reach Cashcove."))
      .mockResolvedValueOnce({
        link: 'https://cashcove.example.com/reset-password#token',
        expires_at: '2026-09-26T12:00:00Z',
      })
    const { all } = await render()
    await openMenu(all, 1)
    await item('reset-link').trigger('click')
    await flushPromises()
    expect(notices.value.at(-1)).toMatchObject({ text: "Can't reach Cashcove.", tone: 'error' })

    await openMenu(all, 1)
    await item('reset-link').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenLastCalledWith('user-sam')
    const dialog = page().find('.v-overlay--active .app-dialog')
    expect(dialog.find('h2').text()).toBe('Password reset link for Sam Lee')
    expect(dialog.find('[data-test="one-time-link-value"]').text()).toBe(
      'https://cashcove.example.com/reset-password#token',
    )
    await click('.v-overlay--active [data-test="link-done"]')
    await flushPromises()
    expect(page().find('.v-overlay--active .app-dialog').exists()).toBe(false)
  })

  it('turns off two-step verification for someone locked out', async () => {
    const reset = vi.spyOn(users, 'resetTwoFactor').mockResolvedValue(undefined)
    const { all, wrapper } = await render({ members: [alex, taylor] })
    await openMenu(all, 1)
    await item('reset-two-step').trigger('click')
    expect(confirmRequest.value?.title).toBe('Turn off two-step verification for Taylor Reed?')
    await answer(false)
    expect(reset).not.toHaveBeenCalled()

    await openMenu(all, 1)
    await item('reset-two-step').trigger('click')
    await answer(true)
    expect(reset).toHaveBeenCalledWith('user-taylor')
    expect(wrapper.emitted('updated')?.[0]).toEqual([
      { ...taylor, details: { ...taylor.details, totp_enabled: false } },
    ])
    expect(notices.value.at(-1)?.text).toBe('Two-step verification is off for Taylor Reed')
  })

  it('removes someone once confirmed', async () => {
    const remove = vi.spyOn(users, 'removeMember').mockResolvedValue(undefined)
    const { all, wrapper } = await render()
    await openMenu(all, 1)
    await item('remove').trigger('click')
    expect(confirmRequest.value).toMatchObject({ title: 'Remove Sam Lee?', tone: 'error' })
    await answer(false)
    expect(wrapper.emitted('removed')).toBeUndefined()

    await openMenu(all, 1)
    await item('remove').trigger('click')
    await answer(true)
    expect(remove).toHaveBeenCalledWith('user-sam')
    expect(wrapper.emitted('removed')?.[0]).toEqual([sam])
    expect(notices.value.at(-1)?.text).toBe('Removed Sam Lee')
  })
})
