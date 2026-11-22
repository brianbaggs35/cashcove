import { nextTick } from 'vue'

import type { UsageDay } from '@/api/ai'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences } from '@/test/fixtures'
import { makeUsage } from '@/test/ai'
import { mountWithPlugins } from '@/test/mount'
import type { Grouping } from '@/views/ai/usage'
import UsageChart from '@/views/ai/UsageChart.vue'

/** `count` days from September 1st with the same use each. */
function span(count: number, cost = 500, calls = 1): UsageDay[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 1 + index))
    return { day: date.toISOString().slice(0, 10), calls, tokens: calls * 1000, cost_micros: cost }
  })
}

async function render(
  days: UsageDay[] = makeUsage().days,
  width = 1280,
  by: Grouping = 'day',
  weekStartsOn: 'sunday' | 'monday' = 'sunday',
) {
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
  const { wrapper } = await mountWithPlugins(UsageChart, {
    width,
    props: { days, by },
    beforeMount: () => {
      const preferences = makePreferences()
      preferences.general.week_starts_on = weekStartsOn
      usePreferencesStore().saved = preferences
    },
  })
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

  it('has a bar for each week or month when it is asked for them', async () => {
    const weeks = await render(span(90), 1280, 'week')
    expect(weeks.scrub().attributes('max')).toBe('13')
    await weeks.scrub().setValue(0)
    expect(weeks.scrub().attributes('aria-valuetext')).toMatch(/^Sep 1\s*[–-]\s*5, 2026: /)
    expect(weeks.scrub().attributes('aria-label')).toBe('What it cost, one week at a time')

    // From September to the end of June.
    const months = await render(span(300), 1280, 'month')
    expect(months.scrub().attributes('max')).toBe('9')
    expect(months.scrub().attributes('aria-label')).toBe('What it cost, one month at a time')
  })

  it('starts its weeks on the day the household’s weeks start on', async () => {
    // The 1st of September 2026 is a Tuesday.
    const sunday = await render(span(14), 1280, 'week', 'sunday')
    await sunday.scrub().setValue(1)
    expect(sunday.scrub().attributes('aria-valuetext')).toMatch(/^Sep 6\s*[–-]\s*12, 2026: 7 calls/)

    const monday = await render(span(14), 1280, 'week', 'monday')
    await monday.scrub().setValue(1)
    expect(monday.scrub().attributes('aria-valuetext')).toMatch(/^Sep 7\s*[–-]\s*13, 2026: 7 calls/)
  })

  it('says when the bars at either end are only part of a week or a month', async () => {
    const days = await render(span(30))
    expect(days.find('chart-frame').text()).not.toContain('either end')

    const weeks = await render(span(90), 1280, 'week')
    expect(weeks.find('chart-frame').text()).toContain(
      'The bars at either end only cover the days in the range, not a whole week.',
    )

    const months = await render(span(300), 1280, 'month')
    expect(months.find('chart-frame').text()).toContain('not a whole month.')

    // Whole months, with nothing cut off, need no explaining.
    const whole = await render(
      span(28).map((day, index) => ({
        ...day,
        day: `2026-02-${String(index + 1).padStart(2, '0')}`,
      })),
      1280,
      'month',
    )
    expect(whole.find('chart-frame').text()).not.toContain('either end')
  })

  it('shows the tokens or the calls instead of the cost when asked', async () => {
    const { wrapper, find } = await render()
    const heading = () => wrapper.find('h3').text()
    const axis = () => wrapper.findAll('.usage__axis span').map((tick) => tick.text())
    expect(heading()).toBe('What it cost')
    expect(find('usage-measure').attributes('aria-label')).toBe('What the bars show')
    expect(find('usage-measure-cost').classes()).toContain('v-btn--active')
    expect(axis()[1]).toMatch(/^\$/)

    await find('usage-measure-tokens').trigger('click')
    expect(heading()).toBe('Tokens used')
    expect(find('chart-frame').text()).toContain('What the AI was sent and what it sent back')
    expect(find('usage-measure-tokens').classes()).toContain('v-btn--active')
    expect(find('usage-measure-cost').classes()).not.toContain('v-btn--active')
    expect(axis()).toEqual(['0', '10K', '20K', '30K'])
    expect(find('usage-scrub').attributes('aria-label')).toBe('Tokens used, one day at a time')

    await find('usage-measure-calls').trigger('click')
    expect(heading()).toBe('Calls made')
    // A few calls climb in whole steps.
    expect(axis()).toEqual(['0', '1', '2', '3', '4'])
    expect(find('usage-scrub').attributes('aria-label')).toBe('Calls made, one day at a time')

    await find('usage-measure-cost').trigger('click')
    expect(heading()).toBe('What it cost')
  })

  it('shows all three of them in a bar’s tip and in the table, whatever the bars show', async () => {
    const { find, pointAt } = await render()

    await find('usage-measure-calls').trigger('click')
    await pointAt(4)

    expect(find('usage-tip').text()).toContain('$0.0031')
    expect(find('usage-tip').text()).toContain('3 calls · 25K tokens')
  })

  it('lets go of the bar being read when the bars change', async () => {
    const { wrapper, find, pointAt } = await render()
    await pointAt(4)
    expect(find('usage-tip').exists()).toBe(true)

    await wrapper.setProps({ by: 'week' })

    expect(find('usage-tip').exists()).toBe(false)
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

  it('says when there was use with no cost to show, and that the rest is still counted', async () => {
    const { find } = await render(span(7, 0, 2))

    expect(find('usage-plot').exists()).toBe(false)
    expect(find('usage-free').text()).toContain('Nothing here has a cost')

    // The tokens and the calls are there to look at instead.
    await find('usage-measure-tokens').trigger('click')
    expect(find('usage-free').exists()).toBe(false)
    expect(find('usage-plot').exists()).toBe(true)
    await find('usage-measure-calls').trigger('click')
    expect(find('usage-plot').exists()).toBe(true)
  })

  it('says when there was use with no tokens to show', async () => {
    const days = span(7, 0, 2).map((day) => ({ ...day, tokens: 0 }))
    const { find } = await render(days)

    await find('usage-measure-tokens').trigger('click')

    expect(find('usage-plot').exists()).toBe(false)
    expect(find('usage-free').text()).toContain('didn’t say how many tokens')
  })
})
