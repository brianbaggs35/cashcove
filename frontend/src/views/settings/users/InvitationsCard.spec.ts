import { flushPromises } from '@vue/test-utils'

import { ApiError } from '@/api/client'
import * as users from '@/api/users'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { click, page } from '@/test/dom'
import { makeInvitation } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import InvitationsCard from '@/views/settings/users/InvitationsCard.vue'

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

const riley = makeInvitation({ expires_at: daysFromNow(6.1) })
const old = makeInvitation({
  id: 'invitation-kim',
  name: 'Kim Diaz',
  email: 'kim@example.com',
  role: 'admin',
  invited_by: null,
  expires_at: daysFromNow(-2),
})

async function render() {
  const mounted = await mountWithPlugins(InvitationsCard, {
    width: 1280,
    props: { invitations: [riley, old] },
  })
  const all = (selector: string) => mounted.wrapper.findAll(`[data-test="${selector}"]`)
  return { ...mounted, all }
}

async function choose(
  all: (selector: string) => { trigger: (event: string) => Promise<void> }[],
  index: number,
  action: string,
) {
  // Vuetify ignores a click that would reopen a menu within 50ms of it closing.
  await new Promise((resolve) => setTimeout(resolve, 60))
  await all('invitation-actions')[index]!.trigger('click')
  await flushPromises()
  await click(`.v-overlay--active [data-test="invitation-${action}"]`)
  await flushPromises()
}

describe('InvitationsCard', () => {
  it('lists the invitations waiting to be accepted', async () => {
    const { all } = await render()
    const [first, second] = all('invitation')
    expect(first!.text()).toContain('Riley Chen')
    expect(first!.text()).toContain('riley@example.com')
    expect(first!.find('[data-test="role-viewer"]').exists()).toBe(true)
    expect(first!.text()).toMatch(/Invited by Alex Morgan ·\s+Expires in 6 days/)
    expect(first!.find('[data-test="invitation-expired"]').exists()).toBe(false)
    expect(second!.find('[data-test="role-admin"]').exists()).toBe(true)
    expect(second!.find('[data-test="invitation-expired"]').text()).toBe('Expired')
    expect(second!.text()).not.toContain('Invited by')
    expect(second!.text()).toMatch(/kim@example.com\s+Expired\s+2 days ago/)
  })

  it('creates a new link for an invitation', async () => {
    const renewed = { ...old, expires_at: daysFromNow(7) }
    const renew = vi
      .spyOn(users, 'renewInvitation')
      .mockRejectedValueOnce(new ApiError(404, 'That invitation was cancelled.'))
      .mockResolvedValueOnce({
        invitation: renewed,
        link: 'https://cashcove.example.com/invite#new',
      })
    const { all, wrapper } = await render()
    await choose(all, 1, 'renew')
    expect(notices.value.at(-1)).toMatchObject({
      text: 'That invitation was cancelled.',
      tone: 'error',
    })
    expect(wrapper.emitted('renewed')).toBeUndefined()

    await choose(all, 1, 'renew')
    expect(renew).toHaveBeenLastCalledWith('invitation-kim')
    expect(wrapper.emitted('renewed')?.[0]).toEqual([renewed])
    const dialog = page().find('.v-overlay--active .app-dialog')
    expect(dialog.find('h2').text()).toBe('New invitation link for Kim Diaz')
    expect(dialog.text()).toContain('Their earlier link no longer works.')
    expect(dialog.find('[data-test="one-time-link-value"]').text()).toBe(
      'https://cashcove.example.com/invite#new',
    )
    await click('.v-overlay--active [data-test="link-done"]')
    await flushPromises()
    expect(page().find('.v-overlay--active .app-dialog').exists()).toBe(false)
  })

  it('cancels an invitation once confirmed', async () => {
    const revoke = vi.spyOn(users, 'revokeInvitation').mockResolvedValue(undefined)
    const { all, wrapper } = await render()
    await choose(all, 0, 'revoke')
    expect(confirmRequest.value).toMatchObject({
      title: "Cancel Riley Chen's invitation?",
      cancelText: 'Keep it',
    })
    confirmRequest.value!.resolve(false)
    await flushPromises()
    expect(wrapper.emitted('revoked')).toBeUndefined()

    await choose(all, 0, 'revoke')
    await confirmRequest.value!.action!()
    confirmRequest.value!.resolve(true)
    await flushPromises()
    expect(revoke).toHaveBeenCalledWith('invitation-riley')
    expect(wrapper.emitted('revoked')?.[0]).toEqual([riley])
    expect(notices.value.at(-1)?.text).toBe("Cancelled Riley Chen's invitation")
  })
})
