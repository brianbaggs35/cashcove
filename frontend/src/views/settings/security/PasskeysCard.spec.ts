import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import { ApiError } from '@/api/client'
import * as flows from '@/auth/passkeyFlows'
import * as passkeys from '@/auth/passkeys'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { click, page } from '@/test/dom'
import { makePasskey, makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import PasskeysCard from '@/views/settings/security/PasskeysCard.vue'

const laptop = makePasskey({
  id: 'p1',
  credential_id: 'c1',
  name: 'iCloud Keychain',
  provider: 'iCloud Keychain',
})
const key = makePasskey({
  id: 'p2',
  credential_id: 'c2',
  name: 'Security key',
  provider: 'YubiKey 5',
  backed_up: false,
  last_used_at: null,
})

interface Options {
  list?: account.Passkey[] | Error
  user?: ReturnType<typeof makeUser>
  session?: Parameters<typeof makeSessionState>[0]
  passkeysWork?: boolean
}

async function render({
  list = [laptop, key],
  user = makeUser({ passkey_count: 2 }),
  session = {},
  passkeysWork = true,
}: Options = {}) {
  vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(passkeysWork)
  vi.spyOn(passkeys, 'signalCurrentPasskeys').mockResolvedValue(undefined)
  const fetch = vi.spyOn(account, 'fetchPasskeys')
  if (list instanceof Error) fetch.mockRejectedValue(list)
  else fetch.mockResolvedValue(list)
  const mounted = await mountWithPlugins(PasskeysCard, {
    props: { user },
    session: makeSessionState({ user, ...session }),
  })
  await flushPromises()
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  const all = (selector: string) => mounted.wrapper.findAll(`[data-test="${selector}"]`)
  return { ...mounted, find, all }
}

describe('PasskeysCard', () => {
  it('lists passkeys with where they are saved and when they were used', async () => {
    const { all, find } = await render()
    const items = all('passkey')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('Last used')
    expect(items[1]!.text()).toContain('Not used yet')
    // The provider only shows when the name doesn't already say it.
    expect(items[0]!.find('[data-test="passkey-provider"]').exists()).toBe(false)
    expect(items[1]!.find('[data-test="passkey-provider"]').text()).toBe('YubiKey 5')
    expect(items[0]!.find('[data-test="passkey-sync"]').text()).toBe('Synced')
    expect(items[1]!.find('[data-test="passkey-sync"]').text()).toBe('This device only')
    expect(find('passkey-add').exists()).toBe(true)
    // The password manager hears which passkeys are current.
    expect(passkeys.signalCurrentPasskeys).toHaveBeenCalledWith(
      window.location.origin,
      'webauthn-alex',
      ['c1', 'c2'],
    )
  })

  it('invites adding the first passkey', async () => {
    const { find } = await render({ list: [makePasskey({ provider: null })].slice(0, 0) })
    expect(find('passkeys-empty').exists()).toBe(true)
  })

  it('shows a loader, and any error loading', async () => {
    vi.spyOn(account, 'fetchPasskeys').mockReturnValue(new Promise(() => undefined))
    vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(true)
    const loading = await mountWithPlugins(PasskeysCard, { props: { user: makeUser() } })
    expect(loading.wrapper.find('[data-test="passkeys-loading"]').exists()).toBe(true)

    const failed = await render({ list: new Error('Offline.') })
    expect(failed.find('passkey-error').text()).toBe('Offline.')
    expect(failed.find('passkeys-empty').exists()).toBe(false)
  })

  it('shows a provider for a passkey renamed from it', async () => {
    const { find } = await render({
      list: [makePasskey({ name: 'My phone', provider: 'Google Password Manager' })],
    })
    expect(find('passkey-provider').text()).toBe('Google Password Manager')
  })

  it.each([
    [{ passkeys_supported: false }, 'domain name rather than an IP address'],
    [
      { origin: 'https://cashcove.example.com' },
      'Passkeys only work at https://cashcove.example.com.',
    ],
    [{}, "This browser can't use passkeys."],
  ])('explains why passkeys cannot be added (%j)', async (session, text) => {
    const { find } = await render({ session, passkeysWork: Object.keys(session).length > 0 })
    expect(find('passkey-unavailable').text()).toContain(text)
    expect(find('passkey-add').exists()).toBe(false)
  })

  it('adds a passkey', async () => {
    const added = makePasskey({ id: 'p3', credential_id: 'c3', name: 'Windows Hello' })
    vi.spyOn(flows, 'addPasskeyToAccount').mockResolvedValueOnce(null).mockResolvedValue(added)
    const { find, all, wrapper } = await render()
    await find('passkey-add').trigger('click')
    await flushPromises()
    expect(all('passkey')).toHaveLength(2)
    await find('passkey-add').trigger('click')
    await flushPromises()
    expect(all('passkey')).toHaveLength(3)
    expect(useAuthStore().user?.passkey_count).toBe(3)
    expect(notices.value.at(-1)?.text).toBe('Added Windows Hello. You can sign in with it now.')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('explains a passkey that could not be added', async () => {
    vi.spyOn(flows, 'addPasskeyToAccount').mockRejectedValue(
      new Error('This device already has a passkey for Cashcove.'),
    )
    const { find } = await render()
    await find('passkey-add').trigger('click')
    await flushPromises()
    expect(find('passkey-error').text()).toContain('already has a passkey')
  })

  it('renames a passkey', async () => {
    const rename = vi
      .spyOn(account, 'renamePasskey')
      .mockResolvedValue({ ...key, name: 'Blue key' })
    const { all } = await render()
    await all('passkey-rename')[1]!.trigger('click')
    await flushPromises()
    const input = page().find('[data-test="passkey-name"] input')
    expect((input.element as HTMLInputElement).value).toBe('Security key')
    await input.setValue('  Blue key ')
    await click('[data-test="passkey-name-save"]')
    await flushPromises()
    expect(rename).toHaveBeenCalledWith('p2', 'Blue key')
    expect(all('passkey')[1]!.text()).toContain('Blue key')
    expect(notices.value.at(-1)?.text).toBe('Passkey renamed')
    // The dialog's own close button works too.
    await all('passkey-rename')[0]!.trigger('click')
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="passkey-name"]').exists()).toBe(true)
    await click('.v-overlay--active [data-test="dialog-close"]')
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="passkey-name"]').exists()).toBe(false)
  })

  it('checks the new name, and shows why it could not be saved', async () => {
    const rename = vi
      .spyOn(account, 'renamePasskey')
      .mockRejectedValue(new ApiError(404, 'That passkey was removed.'))
    const { all } = await render()
    await all('passkey-rename')[0]!.trigger('click')
    await flushPromises()
    const input = page().find('[data-test="passkey-name"] input')
    await input.setValue('  ')
    await flushPromises()
    expect(page().find('[data-test="passkey-name"]').text()).toContain('Give it a name')
    await page().find('.v-overlay--active form').trigger('submit')
    expect(rename).not.toHaveBeenCalled()
    await input.setValue('x'.repeat(81))
    await flushPromises()
    expect(page().find('[data-test="passkey-name"]').text()).toContain(
      'Keep it under 80 characters',
    )
    expect(page().find('[data-test="passkey-name-save"]').attributes('disabled')).toBeDefined()
    await input.setValue('Laptop')
    await page().find('.v-overlay--active form').trigger('submit')
    await flushPromises()
    expect(page().find('[data-test="passkey-name"]').text()).toContain('That passkey was removed.')
    // Cancel closes it.
    const cancel = page()
      .findAll('.v-overlay--active .app-dialog__actions button')
      .find((button) => button.text() === 'Cancel')!
    await cancel.trigger('click')
    expect(page().find('.v-overlay--active [data-test="passkey-name"]').exists()).toBe(false)
  })

  it('removes a passkey once confirmed', async () => {
    const remove = vi.spyOn(account, 'removePasskey').mockResolvedValue(undefined)
    const { all, wrapper } = await render({
      user: makeUser({ passkey_count: 2, totp_enabled: true }),
    })
    await all('passkey-remove')[0]!.trigger('click')
    expect(confirmRequest.value?.title).toBe('Remove iCloud Keychain?')
    expect(confirmRequest.value?.text).toContain('asks your password manager to forget it')
    await confirmRequest.value!.action!()
    confirmRequest.value!.resolve(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('p1')
    expect(all('passkey')).toHaveLength(1)
    expect(useAuthStore().user?.passkey_count).toBe(1)
    expect(passkeys.signalCurrentPasskeys).toHaveBeenLastCalledWith(
      window.location.origin,
      'webauthn-alex',
      ['c2'],
    )
    expect(notices.value.at(-1)?.text).toBe('Removed iCloud Keychain')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('warns before removing the last way in besides the password, and can be cancelled', async () => {
    const { all } = await render({ list: [laptop], user: makeUser({ passkey_count: 1 }) })
    await all('passkey-remove')[0]!.trigger('click')
    expect(confirmRequest.value?.text).toContain('your password alone will get you in')
    confirmRequest.value!.resolve(false)
    await flushPromises()
    expect(all('passkey')).toHaveLength(1)
  })
})
