import { nextTick } from 'vue'

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
  // The plot is 700 pixels wide, wherever it is.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 700,
    bottom: 200,
    width: 700,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  const { wrapper } = await mountWithPlugins(UsageChart, { width, props: { days } })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const plot = () => wrapper.find('.usage__plot')
  const scrub = () => find('usage-scrub')
  /** Moves a pointer over the middle of a bar, as a mouse or a finger would. */
  const pointAt = async (index: number, count = 7, type = 'pointermove') => {
    const clientX = ((index + 0.5) / count) * 700
    plot().element.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }))
    await nextTick()
  }
  return { wrapper, find, plot, scrub, pointAt }
}

describe('UsageChart', () => {
  it('has a bar for each day, and a scrubber that reads them out for anyone who isn’t looking', async () => {
    const { wrapper, find, scrub } = await render()

    expect(find('usage-plot').exists()).toBe(true)
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('.usage__axis').attributes('aria-hidden')).toBe('true')
    // One thing to reach, not a button for each bar, and it starts on the latest day.
    expect(wrapper.findAll('button.usage__hit')).toHaveLength(0)
    expect(scrub().attributes('type')).toBe('range')
    expect(scrub().attributes('min')).toBe('0')
    expect(scrub().attributes('max')).toBe('6')
    expect((scrub().element as HTMLInputElement).value).toBe('6')
    expect(scrub().attributes('aria-valuetext')).toMatch(/^Sep 20, 2026: \d+ calls, /)
    expect(find('usage-tip').exists()).toBe(false)
    expect(find('usage-cursor').exists()).toBe(false)
  })

  it('shows a day’s numbers beside its bar when it is pointed at or touched', async () => {
    const { find, plot, pointAt } = await render()

    await pointAt(4)
    expect(find('usage-tip').text()).toContain('Sep 18, 2026')
    expect(find('usage-tip').text()).toContain('$0.0031')
    expect(find('usage-tip').text()).toContain('3 calls · 25K tokens')
    expect(find('usage-tip').attributes('aria-hidden')).toBe('true')
    // That bar is picked out.
    expect(find('usage-cursor').attributes('style')).toContain('left: 57.14')
    expect(find('usage-cursor').attributes('style')).toContain('width: 14.28')

    await pointAt(1, 7, 'pointerdown')
    expect(find('usage-tip').text()).toContain('Sep 15, 2026')

    plot().element.dispatchEvent(new MouseEvent('pointerleave'))
    await nextTick()
    expect(find('usage-tip').exists()).toBe(false)
    expect(find('usage-cursor').exists()).toBe(false)
  })

  it('reads the first and last bars when pointed past either end of the plot', async () => {
    const { find, plot } = await render()

    plot().element.dispatchEvent(new MouseEvent('pointermove', { clientX: -40, bubbles: true }))
    await nextTick()
    expect(find('usage-tip').text()).toContain('Sep 14, 2026')

    plot().element.dispatchEvent(new MouseEvent('pointermove', { clientX: 5000, bubbles: true }))
    await nextTick()
    expect(find('usage-tip').text()).toContain('Sep 20, 2026')
  })

  it('reads each day as the keyboard moves the scrubber', async () => {
    const { find, scrub } = await render()
    const value = () => (scrub().element as HTMLInputElement).value

    await scrub().trigger('focus')
    expect(find('usage-tip').text()).toContain('Sep 20, 2026')

    await scrub().setValue(1)
    expect(find('usage-tip').text()).toContain('Sep 15, 2026')
    expect(scrub().attributes('aria-valuetext')).toBe('Sep 15, 2026: 2 calls, 9K tokens, $0.0012')
    await scrub().setValue(0)
    expect(find('usage-tip').text()).toContain('Sep 14, 2026')
    expect(scrub().attributes('aria-valuetext')).toBe('Sep 14, 2026: 0 calls, 0 tokens, $0.00')
    expect(value()).toBe('0')

    // Escape and leaving stop the reading, and moving again starts it.
    await scrub().trigger('keydown', { key: 'Escape' })
    expect(find('usage-tip').exists()).toBe(false)
    await scrub().setValue(4)
    expect(find('usage-tip').text()).toContain('Sep 18, 2026')
    await scrub().trigger('blur')
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
    expect(quarter.scrub().attributes('max')).toBe('12')
    await quarter.scrub().setValue(0)
    expect(quarter.scrub().attributes('aria-valuetext')).toContain('The week of Sep 1, 2026')

    const year = await render(span(365))
    expect(year.scrub().attributes('max')).toBe('11')
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
