import { flushPromises } from '@vue/test-utils'

import { mountWithPlugins } from '@/test/mount'
import PeriodNav from '@/views/budget/PeriodNav.vue'

async function render(props: Record<string, unknown> = {}) {
  const mounted = await mountWithPlugins(PeriodNav, {
    width: 1280,
    route: '/budget',
    props: {
      title: 'September 2026',
      subtitle: '10 days left',
      previous: { query: { on: '2026-08-01' } },
      next: null,
      current: true,
      back: { query: {} },
      backText: 'Back to this month',
      ...props,
    },
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('PeriodNav', () => {
  it('names the period and where it is, with links only to periods that exist', async () => {
    const { find } = await render()

    expect(find('period-title').text()).toBe('September 2026')
    expect(find('period-subtitle').text()).toBe('10 days left')
    expect(find('period-previous').attributes('href')).toBe('/budget?on=2026-08-01')
    expect(find('period-next').attributes('disabled')).toBeDefined()
    expect(find('period-next').attributes('href')).toBeUndefined()
    expect(find('period-back').exists()).toBe(false)
  })

  it('has no way back from the first period', async () => {
    const { find } = await render({ previous: null, next: { query: { on: '2026-10-01' } } })

    expect(find('period-previous').attributes('disabled')).toBeDefined()
    expect(find('period-next').attributes('href')).toBe('/budget?on=2026-10-01')
  })

  it('goes to the periods either side, and back to the current one', async () => {
    const { find, router } = await render({
      previous: { query: { on: '2026-07-01' } },
      next: { query: { on: '2026-09-01' } },
      current: false,
      back: { query: { budget: 'budget-monthly' } },
    })

    expect(find('period-back').text()).toBe('Back to this month')
    await find('period-previous').trigger('click')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ on: '2026-07-01' })
    })
    await find('period-next').trigger('click')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ on: '2026-09-01' })
    })
    await find('period-back').trigger('click')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ budget: 'budget-monthly' })
    })
  })

  it('needs no subtitle', async () => {
    const { find } = await render({ subtitle: undefined })

    expect(find('period-subtitle').exists()).toBe(false)
  })
})
