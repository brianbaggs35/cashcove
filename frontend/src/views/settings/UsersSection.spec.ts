import { flushPromises } from '@vue/test-utils'

import * as users from '@/api/users'
import { makeInvitation, makeMember, makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import ActivityCard from '@/views/settings/ActivityCard.vue'
import InvitationsCard from '@/views/settings/users/InvitationsCard.vue'
import InviteDialog from '@/views/settings/users/InviteDialog.vue'
import MembersCard from '@/views/settings/users/MembersCard.vue'
import UsersSection from '@/views/settings/UsersSection.vue'

const alex = makeMember({
  id: 'user-alex',
  name: 'Alex Morgan',
  email: 'alex@example.com',
  role: 'admin',
})
const sam = makeMember()
const riley = makeInvitation()
const kim = makeInvitation({ id: 'invitation-kim', name: 'Kim Diaz', email: 'kim@example.com' })

async function render(role: 'admin' | 'viewer' = 'admin') {
  const members = vi.spyOn(users, 'fetchMembers').mockResolvedValue([alex, sam])
  const invitations = vi.spyOn(users, 'fetchInvitations').mockResolvedValue([riley, kim])
  const activity = vi.spyOn(users, 'fetchHouseholdActivity').mockResolvedValue([])
  const mounted = await mountWithPlugins(UsersSection, {
    width: 1280,
    session: makeSessionState({ user: makeUser({ role }) }),
  })
  await flushPromises()
  return { ...mounted, members, invitations, activity }
}

describe('UsersSection', () => {
  it('shows admins everyone, the open invitations and the household activity', async () => {
    const { wrapper, invitations, activity } = await render()
    expect(wrapper.find('[data-test="read-only-notice"]').exists()).toBe(false)
    expect(wrapper.findComponent(MembersCard).props()).toMatchObject({
      members: [alex, sam],
      loaded: true,
      busy: false,
      error: null,
    })
    expect(wrapper.findComponent(InvitationsCard).props('invitations')).toEqual([riley, kim])
    expect(invitations).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(ActivityCard).exists()).toBe(true)
    expect(activity).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('two roles, and one household per install')
  })

  it('keeps the lists and the activity up to date as things change', async () => {
    const { wrapper, members, activity } = await render()
    const people = wrapper.findComponent(MembersCard)
    const pending = () => wrapper.findComponent(InvitationsCard)

    people.vm.$emit('updated', { ...sam, role: 'admin' })
    await flushPromises()
    expect(people.props('members')).toEqual([alex, { ...sam, role: 'admin' }])
    people.vm.$emit('removed', sam)
    await flushPromises()
    expect(people.props('members')).toEqual([alex])

    const renewed = { ...kim, expires_at: '2099-12-01T12:00:00Z' }
    pending().vm.$emit('renewed', renewed)
    await flushPromises()
    expect(pending().props('invitations')).toEqual([riley, renewed])
    const jo = makeInvitation({ id: 'invitation-jo', name: 'Jo Park' })
    wrapper.findComponent(InviteDialog).vm.$emit('invited', jo)
    await flushPromises()
    expect(pending().props('invitations')).toEqual([jo, riley, renewed])
    for (const invitation of [jo, riley, renewed]) {
      pending().vm.$emit('revoked', invitation)
      await flushPromises()
    }
    expect(pending().exists()).toBe(false)
    expect(activity).toHaveBeenCalledTimes(8)

    people.vm.$emit('retry')
    await flushPromises()
    expect(members).toHaveBeenCalledTimes(2)
  })

  it('opens the invite dialog', async () => {
    const { wrapper } = await render()
    expect(wrapper.findComponent(InviteDialog).props('modelValue')).toBe(false)
    wrapper.findComponent(MembersCard).vm.$emit('invite')
    await flushPromises()
    expect(wrapper.findComponent(InviteDialog).props('modelValue')).toBe(true)
    wrapper.findComponent(InviteDialog).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(wrapper.findComponent(InviteDialog).props('modelValue')).toBe(false)
  })

  it('shows viewers who is in the household, and nothing to manage', async () => {
    const { wrapper, invitations, activity } = await render('viewer')
    expect(wrapper.find('[data-test="read-only-notice"]').text()).toContain(
      'Only an admin can invite people',
    )
    expect(wrapper.findComponent(MembersCard).props('members')).toEqual([alex, sam])
    expect(invitations).not.toHaveBeenCalled()
    expect(activity).not.toHaveBeenCalled()
    expect(wrapper.findComponent(InvitationsCard).exists()).toBe(false)
    expect(wrapper.findComponent(InviteDialog).exists()).toBe(false)
  })
})
