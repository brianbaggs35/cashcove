import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import { ApiError } from '@/api/client'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { makeDeviceSession } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import DevicesCard from '@/views/settings/security/DevicesCard.vue'

const here = makeDeviceSession()
const phone = makeDeviceSession({
  id: 'session-2',
  device: 'Safari on iPhone',
  kind: 'phone',
  current: false,
  remember: true,
  last_seen_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
})
const tablet = makeDeviceSession({
  id: 'session-3',
  device: 'Chrome on iPad',
  kind: 'tablet',
  current: false,
  ip_address: null,
  remember: true,
})
const unknown = makeDeviceSession({
  id: 'session-4',
  device: 'Unknown browser',
  kind: 'unknown',
  current: false,
  ip_address: null,
})

async function render(
  sessions: account.SignedInSession[] = [here, phone, tablet, unknown],
  width = 1280,
) {
  const fetch = vi.spyOn(account, 'fetchSessions').mockResolvedValue(sessions)
  const mounted = await mountWithPlugins(DevicesCard, { width })
  await flushPromises()
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  const all = (selector: string) => mounted.wrapper.findAll(`[data-test="${selector}"]`)
  return { ...mounted, find, all, fetch }
}

describe('DevicesCard', () => {
  it('lists where you are signed in, this device first', async () => {
    const { all } = await render()
    const devices = all('device')
    expect(devices).toHaveLength(4)
    expect(devices[0]!.find('[data-test="device-current"]').text()).toBe('This device')
    expect(devices[0]!.text()).toContain('Active now')
    expect(devices[0]!.text()).toContain('192.168.1.20')
    expect(devices[0]!.find('[data-test="device-sign-out"]').exists()).toBe(false)
    expect(devices[1]!.text()).toContain('Active 5 days ago')
    expect(devices[1]!.text().replace(/\s+/g, ' ')).toContain(
      '192.168.1.20 · Stays signed in for up to 30 days',
    )
    expect(devices[2]!.find('[data-test="device-remembered"]').exists()).toBe(true)
    expect(devices[2]!.text()).not.toContain(' · Stays')
    expect(devices[3]!.find('[data-test="device-remembered"]').exists()).toBe(false)
    expect(devices[3]!.find('[data-test="device-current"]').exists()).toBe(false)
    expect(devices[1]!.find('[data-test="device-sign-out"]').text()).toBe('Sign out')
  })

  it('keeps just the icon for signing out on phones', async () => {
    const { all } = await render([here, phone], 400)
    const button = all('device')[1]!.find('[data-test="device-sign-out"]')
    expect(button.text()).toBe('')
    expect(button.attributes('aria-label')).toBe('Sign out Safari on iPhone')
    await button.trigger('click')
    expect(confirmRequest.value?.title).toBe('Sign out Safari on iPhone?')
  })

  it('shows a loader, errors, and refreshes', async () => {
    vi.spyOn(account, 'fetchSessions').mockReturnValue(new Promise(() => undefined))
    const loading = await mountWithPlugins(DevicesCard)
    expect(loading.wrapper.find('[data-test="devices-loading"]').exists()).toBe(true)

    const { find, all, fetch } = await render([here])
    expect(find('devices-sign-out-others').exists()).toBe(false)
    fetch.mockRejectedValueOnce(new ApiError(0, "Can't reach Cashcove."))
    await find('devices-refresh').trigger('click')
    await flushPromises()
    expect(find('devices-error').text()).toBe("Can't reach Cashcove.")
    // What loaded before stays on show.
    expect(all('device')).toHaveLength(1)
    fetch.mockResolvedValueOnce([here, phone])
    await find('devices-refresh').trigger('click')
    await flushPromises()
    expect(find('devices-error').exists()).toBe(false)
    expect(all('device')).toHaveLength(2)
  })

  it('signs out one device once confirmed', async () => {
    const end = vi.spyOn(account, 'endSession').mockResolvedValue(undefined)
    const { all, wrapper } = await render()
    await all('device-sign-out')[0]!.trigger('click')
    expect(confirmRequest.value?.title).toBe('Sign out Safari on iPhone?')
    confirmRequest.value!.resolve(false)
    await flushPromises()
    expect(all('device')).toHaveLength(4)

    await all('device-sign-out')[0]!.trigger('click')
    await confirmRequest.value!.action!()
    confirmRequest.value!.resolve(true)
    await flushPromises()
    expect(end).toHaveBeenCalledWith('session-2')
    expect(all('device')).toHaveLength(3)
    expect(notices.value.at(-1)?.text).toBe('Signed out Safari on iPhone')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it.each([
    [[here, phone], 1, '1 other device'],
    [[here, phone, tablet, unknown], 3, '3 other devices'],
  ])('signs out everywhere else', async (sessions, ended, devices) => {
    const endOthers = vi.spyOn(account, 'endOtherSessions').mockResolvedValue({ ended })
    const { all, find, wrapper } = await render(sessions)
    await find('devices-sign-out-others').trigger('click')
    expect(confirmRequest.value?.text).toContain(`Anyone using Cashcove on ${devices} will have to`)
    confirmRequest.value!.resolve(false)
    await flushPromises()
    expect(endOthers).not.toHaveBeenCalled()

    await find('devices-sign-out-others').trigger('click')
    await confirmRequest.value!.action!()
    confirmRequest.value!.resolve(true)
    await flushPromises()
    expect(all('device')).toHaveLength(1)
    expect(find('devices-sign-out-others').exists()).toBe(false)
    expect(notices.value.at(-1)?.text).toBe(`Signed out ${devices}`)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})
