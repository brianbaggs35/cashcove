import RelativeTime from '@/components/ui/RelativeTime.vue'
import { mountWithPlugins } from '@/test/mount'
import { formatDateTime } from '@/utils/format'

describe('RelativeTime', () => {
  afterEach(() => vi.useRealTimers())

  it('says how long ago, keeps it current and gives the exact time on hover', async () => {
    vi.useFakeTimers({
      now: new Date(2026, 8, 25, 12, 0),
      toFake: ['Date', 'setInterval', 'clearInterval'],
    })
    const value = new Date(2026, 8, 25, 11, 58).toISOString()
    const { wrapper } = await mountWithPlugins(RelativeTime, { props: { value } })
    const time = wrapper.find('time')
    expect(time.text()).toBe('2 minutes ago')
    expect(time.attributes('datetime')).toBe(value)
    expect(time.attributes('title')).toBe(formatDateTime(value))
    vi.advanceTimersByTime(60_000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('time').text()).toBe('3 minutes ago')
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
