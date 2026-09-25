import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import type { ActivityEntry } from '@/api/account'
import { makeActivity } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import ActivityCard from '@/views/settings/ActivityCard.vue'

const today = new Date()
const at = (daysAgo: number, hour: number) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour).toISOString()

async function render(load: () => Promise<ActivityEntry[]>, props: Record<string, unknown> = {}) {
  const mounted = await mountWithPlugins(ActivityCard, {
    props: { title: 'Recent activity', subtitle: 'Sign-ins and changes.', load, ...props },
  })
  await flushPromises()
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  return { ...mounted, find }
}

describe('ActivityCard', () => {
  it('groups activity by day, with the time, device and address', async () => {
    const entries = [
      makeActivity({ id: '1', created_at: at(0, 9), details: { method: 'passkey' } }),
      makeActivity({
        id: '2',
        created_at: at(0, 8),
        event: 'password_changed',
        device: null,
        ip_address: null,
      }),
      makeActivity({ id: '3', created_at: at(1, 20), event: 'sign_in_failed', details: {} }),
    ]
    const { wrapper } = await render(() => Promise.resolve(entries))
    const days = wrapper.findAll('[data-test="activity-day"]')
    expect(days.map((day) => day.find('h3').text())).toEqual(['Today', 'Yesterday'])
    const items = wrapper.findAll('[data-test="activity-item"]')
    expect(items[0]!.text()).toContain('Signed in with a passkey')
    expect(items[0]!.text()).toContain('Chrome on macOS · 192.168.1.20')
    expect(items[0]!.find('.v-avatar').classes()).toContain('text-success')
    // Only the time is known for this one.
    expect(items[1]!.find('.text-body-small').text()).not.toContain('·')
    expect(items[1]!.find('.v-avatar').classes()).toContain('text-info')
    expect(items[2]!.find('.v-avatar').classes()).toContain('text-error')
    expect(wrapper.find('[data-test="activity-more"]').exists()).toBe(false)
  })

  it("describes the household's activity with names", async () => {
    const entries = [makeActivity({ user_name: 'Sam Lee', event: 'signed_out', details: {} })]
    const { wrapper } = await render(() => Promise.resolve(entries), { perspective: 'household' })
    const item = wrapper.find('[data-test="activity-item"]')
    expect(item.text()).toContain('Sam Lee signed out')
    expect(
      item
        .find('.v-avatar')
        .classes()
        .some((name) => name.startsWith('text-')),
    ).toBe(false)
  })

  it('shows the newest first, with a way to see everything', async () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeActivity({ id: String(index), created_at: at(0, 20 - index) }),
    )
    const { wrapper, find } = await render(() => Promise.resolve(entries), { initial: 3 })
    expect(wrapper.findAll('[data-test="activity-item"]')).toHaveLength(3)
    expect(find('activity-more').text()).toBe('Show all 5')
    await find('activity-more').trigger('click')
    expect(wrapper.findAll('[data-test="activity-item"]')).toHaveLength(5)
    expect(find('activity-more').text()).toBe('Show less')
  })

  it('says when there is nothing yet', async () => {
    const { wrapper } = await render(() => Promise.resolve([]))
    expect(wrapper.text()).toContain('Nothing yet.')
  })

  it('shows a loader, then any error, and refreshes', async () => {
    const load = vi
      .fn<() => Promise<ActivityEntry[]>>()
      .mockReturnValueOnce(new Promise(() => undefined))
    const { find } = await render(load)
    expect(find('activity-loading').exists()).toBe(true)

    load.mockRejectedValueOnce(new Error('Offline.'))
    await find('activity-refresh').trigger('click')
    await flushPromises()
    expect(find('activity-error').text()).toBe('Offline.')

    load.mockResolvedValueOnce([makeActivity()])
    await find('activity-refresh').trigger('click')
    await flushPromises()
    expect(find('activity-item').exists()).toBe(true)
  })

  it('reloads when its parent asks', async () => {
    const load = vi.fn().mockResolvedValue([])
    const card = ref<{ reload: () => Promise<unknown> } | null>(null)
    const Host = defineComponent({
      render: () => h(ActivityCard, { ref: card, title: 'Activity', subtitle: 'All of it.', load }),
    })
    await mountWithPlugins(Host)
    await flushPromises()
    await card.value!.reload()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
