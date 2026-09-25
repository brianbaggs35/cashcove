import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { ApiError } from '@/api/client'
import * as users from '@/api/users'
import { click, page } from '@/test/dom'
import { makeInvitation } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import { formatDateTime } from '@/utils/format'
import InviteDialog from '@/views/settings/users/InviteDialog.vue'

const riley = makeInvitation()
const link = { invitation: riley, link: 'https://cashcove.example.com/invite#token' }

async function render() {
  const open = ref(false)
  const invited = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(InviteDialog, {
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onInvited: invited,
      }),
  })
  await mountWithPlugins(Host, { width: 1280 })
  open.value = true
  await flushPromises()
  return { open, invited }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const field = (name: string) => dialog().find(`[data-test="invite-${name}"]`)
const submit = () => dialog().find('[data-test="invite-submit"]')

async function fillIn(name = '  Riley Chen ', email = ' riley@example.com ') {
  await field('name').find('input').setValue(name)
  await field('email').find('input').setValue(email)
  await flushPromises()
}

describe('InviteDialog', () => {
  it('creates an invitation link for a viewer by default', async () => {
    const invite = vi.spyOn(users, 'inviteMember').mockResolvedValue(link)
    const { invited, open } = await render()
    expect(dialog().find('h2').text()).toBe('Invite someone')
    expect(field('role-viewer').attributes('aria-checked')).toBe('true')
    expect(submit().attributes('disabled')).toBeDefined()

    await fillIn()
    await submit().trigger('click')
    await flushPromises()
    expect(invite).toHaveBeenCalledWith('Riley Chen', 'riley@example.com', 'viewer')
    expect(invited).toHaveBeenCalledWith(riley)
    expect(dialog().find('h2').text()).toBe('Invitation ready')
    expect(dialog().text()).toContain('Send this link to Riley Chen.')
    expect(dialog().find('[data-test="invite-link-value"]').text()).toBe(link.link)
    expect(dialog().text()).toContain(
      `It works once, for riley@example.com, and expires ${formatDateTime(riley.expires_at)}.`,
    )

    await click('.v-overlay--active [data-test="invite-done"]')
    expect(open.value).toBe(false)
  })

  it('invites an admin, then someone else from a fresh form', async () => {
    const invite = vi.spyOn(users, 'inviteMember').mockResolvedValue(link)
    await render()
    await field('role-admin').trigger('click')
    expect(field('role-admin').attributes('aria-checked')).toBe('true')
    expect(field('role-viewer').attributes('aria-checked')).toBe('false')
    await fillIn('Riley Chen', 'riley@example.com')
    // Enter submits the form.
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(invite).toHaveBeenCalledWith('Riley Chen', 'riley@example.com', 'admin')

    await click('.v-overlay--active [data-test="invite-another"]')
    await flushPromises()
    expect(dialog().find('h2').text()).toBe('Invite someone')
    expect((field('name').find('input').element as HTMLInputElement).value).toBe('')
    expect(field('role-viewer').attributes('aria-checked')).toBe('true')
  })

  it('checks the details before sending them', async () => {
    const invite = vi.spyOn(users, 'inviteMember')
    await render()
    await fillIn('   ', 'riley@')
    expect(field('name').text()).toContain('Enter their name')
    expect(field('email').text()).toContain('Enter a valid email address')
    await dialog().find('form').trigger('submit')
    await fillIn('x'.repeat(81), 'riley@example.com')
    expect(field('name').text()).toContain('Keep it under 80 characters')
    expect(submit().attributes('disabled')).toBeDefined()
    expect(invite).not.toHaveBeenCalled()
  })

  it.each([
    [new ApiError(409, 'Someone already uses that email.', { code: 'email_taken' }), 'email'],
    [new ApiError(409, 'Riley already has an invitation.', { code: 'already_invited' }), 'email'],
    [
      new ApiError(422, 'Check the details.', { fields: { email: 'That email looks wrong.' } }),
      'email',
    ],
    [
      new ApiError(422, 'Check the details.', { fields: { name: 'That name is too long.' } }),
      'name',
    ],
    [new ApiError(500, 'Something went wrong.'), 'error'],
  ])('shows why the invitation failed (%s)', async (error, where) => {
    vi.spyOn(users, 'inviteMember').mockRejectedValue(error)
    await render()
    await fillIn()
    await submit().trigger('click')
    await flushPromises()
    const shown = error.fields.email ?? error.fields.name ?? error.message
    expect(field(where).text()).toContain(shown)
    expect(field('error').exists()).toBe(where === 'error')
  })

  it('cancels, and starts afresh the next time it opens', async () => {
    const { open } = await render()
    await fillIn()
    const cancel = dialog()
      .findAll('.app-dialog__actions button')
      .find((button) => button.text() === 'Cancel')!
    await cancel.trigger('click')
    expect(open.value).toBe(false)
    open.value = true
    await flushPromises()
    expect((field('email').find('input').element as HTMLInputElement).value).toBe('')
    await click('.v-overlay--active [data-test="dialog-close"]')
    expect(open.value).toBe(false)
  })
})
