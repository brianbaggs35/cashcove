// Vue Test Utils' flushPromises doesn't rely on setTimeout, which these tests fake.
import { flushPromises } from '@vue/test-utils'

import NotificationHost from '@/components/ui/NotificationHost.vue'
import { notices, notify } from '@/composables/notify'
import { click, page } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'

describe('NotificationHost', () => {
  afterEach(() => vi.useRealTimers())

  it('shows messages one at a time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const { wrapper } = await mountWithPlugins(NotificationHost)
    const snackbar = () => wrapper.findComponent({ name: 'VSnackbar' })
    expect(snackbar().props('modelValue')).toBe(false)
    expect(snackbar().props('timeout')).toBe(4000)

    notify('Settings saved')
    notify("Couldn't save.", 'error')
    await flushPromises()
    expect(snackbar().props('modelValue')).toBe(true)
    expect(page().find('[data-test="notification"]').text()).toContain('Settings saved')

    await click('[data-test="notification-dismiss"]')
    expect(snackbar().props('modelValue')).toBe(false)
    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(notices.value.map((notice) => notice.text)).toEqual(["Couldn't save."])
    expect(snackbar().props('modelValue')).toBe(true)
    expect(snackbar().props('color')).toBe('error')
    expect(snackbar().props('timeout')).toBe(6000)

    // The snackbar timing out closes it too.
    snackbar().vm.$emit('update:modelValue', false)
    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(notices.value).toEqual([])
    expect(snackbar().props('modelValue')).toBe(false)
  })

  it('leaves a newer message alone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const { wrapper } = await mountWithPlugins(NotificationHost)
    notify('First')
    await flushPromises()
    wrapper.findComponent({ name: 'VSnackbar' }).vm.$emit('update:modelValue', true)
    await click('[data-test="notification-dismiss"]')
    // Something else cleared the queue and queued a new message before the snackbar closed.
    notices.value = []
    notify('Second')
    vi.advanceTimersByTime(250)
    expect(notices.value.map((notice) => notice.text)).toEqual(['Second'])
  })
})
