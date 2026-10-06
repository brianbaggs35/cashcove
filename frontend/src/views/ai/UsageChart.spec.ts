import type { UsageDay } from '@/api/ai'
import { makeUsage } from '@/test/ai'
import { mountWithPlugins } from '@/test/mount'
import UsageChart from '@/views/ai/UsageChart.vue'

/** `count` days from September 1st with the same use each. */
function span(count: number, cost = 500, calls = 1): UsageDay[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 1 + index))
    return { day: date.toISOString().slice(0, 10), calls, tokens: calls * 1000, cost_micros: cost }
  })
}

async function render(days: UsageDay[] = makeUsage().days, width = 1280) {
  const { wrapper } = await mountWithPlugins(UsageChart, { width, props: { days } })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  return { wrapper, find }
}

describe('UsageChart', () => {
  it('has a bar for each day, each one saying what it cost for anyone who isn’t looking', async () => {
    const { wrapper, find } = await render()

    expect(find('usage-plot').exists()).toBe(true)
    const bars = wrapper.findAll('[data-test="usage-bar"]')
    expect(bars).toHaveLength(7)
    expect(bars[1]!.attributes('aria-label')).toBe('Sep 15, 2026: 2 calls, 9K tokens, $0.0012')
    expect(bars[0]!.attributes('aria-label')).toBe('Sep 14, 2026: 0 calls, 0 tokens, $0.00')
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('.usage__axis').attributes('aria-hidden')).toBe('true')
  })

  it('shows a day’s numbers beside its bar when pointed at or tabbed to', async () => {
    const { wrapper, find } = await render()
    const bars = wrapper.findAll('[data-test="usage-bar"]')

    expect(find('usage-tip').exists()).toBe(false)
    await bars[4]!.trigger('pointerenter')
    expect(find('usage-tip').text()).toContain('Sep 18, 2026')
    expect(find('usage-tip').text()).toContain('$0.0031')
    expect(find('usage-tip').text()).toContain('3 calls · 25K tokens')
    expect(find('usage-tip').attributes('aria-hidden')).toBe('true')

    await bars[4]!.trigger('pointerleave')
    expect(find('usage-tip').exists()).toBe(false)
    await bars[1]!.trigger('focus')
    expect(find('usage-tip').text()).toContain('Sep 15, 2026')
    await bars[1]!.trigger('blur')
    expect(find('usage-tip').exists()).toBe(false)
  })

  it('reads as a table with every number, which is how anyone not reading the picture gets them', async () => {
    const { wrapper, find } = await render()

    await find('chart-view-table').trigger('click')

    const rows = wrapper.findAll('[data-test="usage-day-row"]')
    expect(rows).toHaveLength(7)
    expect(rows[1]!.findAll('th, td').map((cell) => cell.text())).toEqual([
      'Sep 15, 2026',
      '2',
      '9K',
      '$0.0012',
    ])
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      'Period',
      'Calls',
      'Tokens',
      'Cost',
    ])
  })

  it('puts the calls and tokens under the day in the table on a phone', async () => {
    const { wrapper, find } = await render(makeUsage().days, 400)

    await find('chart-view-table').trigger('click')

    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(['Period', 'Cost'])
    expect(wrapper.findAll('[data-test="usage-day-row"]')[1]!.text()).toContain(
      '2 calls · 9K tokens',
    )
  })

  it('shows a week at a time for a quarter and a month at a time for a year', async () => {
    const quarter = await render(span(90))
    expect(quarter.wrapper.findAll('[data-test="usage-bar"]')).toHaveLength(13)
    expect(
      quarter.wrapper.findAll('[data-test="usage-bar"]')[0]!.attributes('aria-label'),
    ).toContain('The week of Sep 1, 2026')

    const year = await render(span(365))
    expect(year.wrapper.findAll('[data-test="usage-bar"]')).toHaveLength(12)
  })

  it('only labels some of the bars when there are a lot of them, so labels don’t collide', async () => {
    const { wrapper } = await render(span(31))

    const labels = wrapper.findAll('.usage__labels span').map((label) => label.text())
    expect(labels).toHaveLength(31)
    expect(labels.filter(Boolean).length).toBeLessThan(31)
    expect(labels[0]).not.toBe('')
  })

  it('labels fewer of them on a phone', async () => {
    const wide = await render(span(31))
    const narrow = await render(span(31), 400)

    const count = (rendered: Awaited<ReturnType<typeof render>>) =>
      rendered.wrapper.findAll('.usage__labels span').filter((label) => label.text()).length
    expect(count(narrow)).toBeLessThan(count(wide))
  })

  it('says nothing has been used when nothing has', async () => {
    const { find } = await render(span(7, 0, 0))

    expect(find('usage-plot').exists()).toBe(false)
    expect(find('usage-free').exists()).toBe(false)
    expect(find('empty-state').text()).toContain('Nothing used yet')
  })

  it('says when there was use with no cost to show', async () => {
    const { find } = await render(span(7, 0, 2))

    expect(find('usage-plot').exists()).toBe(false)
    expect(find('usage-free').text()).toContain('Nothing here has a cost')
  })
})
