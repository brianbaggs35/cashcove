import { nextTick } from 'vue'

import type { BudgetPeriodView } from '@/api/budget'
import { makePeriod } from '@/test/budgets'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import BudgetPaceChart from '@/views/budget/BudgetPaceChart.vue'

async function render(period = makePeriod(), width = 1280) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 640,
    bottom: 240,
    width: 640,
    height: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  const mounted = await mountWithPlugins(BudgetPaceChart, {
    width,
    props: { period },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  const svg = () => mounted.wrapper.find('.pace__svg')
  /** Points at a day, as a mouse over the chart would. */
  const pointAt = async (day: number, days = 30) => {
    const clientX = 52 + (day / (days - 1)) * 576
    svg().element.dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true }))
    await nextTick()
  }
  return { ...mounted, find, svg, pointAt }
}

const text = (element: { text: () => string }) => element.text().replace(/\s+/g, ' ')

describe('BudgetPaceChart', () => {
  it('draws spending so far against the budget, with where it has got to', async () => {
    const { find, svg, wrapper } = await render()

    expect(svg().attributes('viewBox')).toBe('0 0 640 240')
    expect(text(find('pace-budget-label'))).toBe('Budget $2,000.00')
    expect(text(find('pace-end-label'))).toBe('Spent $1,250.00')
    expect(wrapper.findAll('.pace__axis text').map(text)).toEqual([
      'Sep 1',
      'Sep 11',
      'Sep 20',
      'Sep 30',
    ])
    expect(wrapper.findAll('.pace__grid text').map(text)).toEqual([
      '$0',
      '$500',
      '$1K',
      '$1.5K',
      '$2K',
    ])
    expect(wrapper.find('.pace__line').exists()).toBe(true)
    expect(wrapper.find('.pace__area').exists()).toBe(true)
    expect(find('pace-tip').exists()).toBe(false)
  })

  it('has a legend for its lines, and is narrower on a phone', async () => {
    const { find, svg } = await render(makePeriod(), 400)

    expect(find('chart-legend').text().replace(/\s+/g, ' ')).toBe('Spent Budget Even pace')
    expect(svg().attributes('viewBox')).toBe('0 0 340 240')
  })

  it('reads a day when it is pointed at, and stops when the pointer leaves', async () => {
    const { find, svg, pointAt } = await render()

    await pointAt(10)

    expect(text(find('pace-tip'))).toBe(
      'Friday, September 11$1,084.12spent so far$0.00 that day · $915.88 left',
    )
    expect(find('pace-scrub').attributes('aria-valuetext')).toBe(
      'Friday, September 11: $1,084.12 spent so far, $0.00 that day, $915.88 left.',
    )
    await svg().trigger('pointerleave')
    expect(find('pace-tip').exists()).toBe(false)
    // With nothing pointed at, the scrubber still says where it is: on the latest day.
    expect(find('pace-scrub').attributes('aria-valuetext')).toBe(
      'Sunday, September 20: $1,250.00 spent so far, $0.00 that day, $750.00 left.',
    )
  })

  it('reads the latest day for a pointer past what has been spent so far', async () => {
    const { find, pointAt } = await render()

    await pointAt(27)

    expect(text(find('pace-tip'))).toBe(
      'Sunday, September 20$1,250.00spent so far$0.00 that day · $750.00 left',
    )
  })

  it('keeps the readout on the chart near either edge', async () => {
    const { find, pointAt } = await render()
    const past = await render(
      makePeriod({ current: false, days_gone: 30, expected: null, projected: null }),
    )

    await pointAt(0)
    expect(find('pace-tip').attributes('style')).toContain('translateX(0)')
    await pointAt(10)
    expect(find('pace-tip').attributes('style')).toContain('translateX(-50%)')
    await past.pointAt(29)
    expect(past.find('pace-tip').attributes('style')).toContain('translateX(-100%)')
  })

  it('says when a day is over budget', async () => {
    const { find, pointAt } = await render(
      makePeriod({
        amount: '1000.00',
        spent: '1250.00',
        left: '-250.00',
        daily: [{ day: '2026-09-01', income: '0.00', spent: '1250.00' }],
      }),
    )

    await pointAt(5)

    expect(text(find('pace-tip'))).toContain('Over by $250.00')
  })

  it('reads each day as the keyboard moves the scrubber', async () => {
    const { find, wrapper } = await render()
    const scrub = find('pace-scrub')
    const value = () => (scrub.element as HTMLInputElement).value

    // It covers the days there is spending to read, and starts on the latest.
    expect(scrub.attributes('type')).toBe('range')
    expect(scrub.attributes('min')).toBe('0')
    expect(scrub.attributes('max')).toBe('19')
    expect(value()).toBe('19')
    expect(find('pace-tip').exists()).toBe(false)

    await scrub.trigger('focus')
    expect(find('pace-tip').text()).toContain('Sunday, September 20')

    await scrub.setValue(18)
    expect(find('pace-tip').text()).toContain('Saturday, September 19')
    expect(scrub.attributes('aria-valuetext')).toContain('Saturday, September 19')
    await scrub.setValue(0)
    expect(find('pace-tip').text()).toContain('Tuesday, September 1')
    expect(value()).toBe('0')

    // Escape and leaving stop the reading, and moving again starts it.
    await scrub.trigger('keydown', { key: 'Escape' })
    expect(find('pace-tip').exists()).toBe(false)
    await scrub.setValue(5)
    expect(find('pace-tip').text()).toContain('Sunday, September 6')
    await scrub.trigger('blur')
    expect(wrapper.find('[data-test="pace-tip"]').exists()).toBe(false)
  })

  it('puts the end label above the line when spending is close to the bottom, and beside it near the start', async () => {
    const { find } = await render(
      makePeriod({
        days_gone: 2,
        spent: '5.00',
        daily: [{ day: '2026-09-01', income: '0.00', spent: '5.00' }],
      }),
    )

    const label = find('pace-end-label')
    expect(label.attributes('text-anchor')).toBe('start')
    expect(Number(label.attributes('y'))).toBeLessThan(
      Number(find('pace-end-label').element.previousElementSibling?.getAttribute('cy')),
    )
  })

  describe('the end label', () => {
    /** Where the label sits against the dot: which way it reads from it, and whether it is above. */
    async function placed(changes: Partial<BudgetPeriodView>) {
      const { find } = await render(makePeriod(changes))
      const label = find('pace-end-label')
      const dot = Number(label.element.previousElementSibling?.getAttribute('cy'))
      return {
        anchor: label.attributes('text-anchor'),
        side: Number(label.attributes('y')) < dot ? 'above' : 'below',
      }
    }
    const over = { current: false, days_gone: 30, expected: null, projected: null }
    const spent = (amount: string) => [{ day: '2026-09-01', income: '0.00', spent: amount }]

    it('sits left of the dot and above it, clear of the line that climbs to it', async () => {
      expect(await placed({})).toEqual({ anchor: 'end', side: 'above' })
    })

    it('moves below the dot when the budget line is right above it', async () => {
      expect(await placed({ ...over, daily: spent('2050.00') })).toEqual({
        anchor: 'end',
        side: 'below',
      })
    })

    it('moves below the dot at the top edge of the chart', async () => {
      expect(await placed({ ...over, amount: '100.00', daily: spent('2000.00') })).toEqual({
        anchor: 'end',
        side: 'below',
      })
    })

    it('sits right of the dot and below it early in the period, over the days to come', async () => {
      expect(await placed({ days_gone: 10 })).toEqual({ anchor: 'start', side: 'below' })
    })
  })

  it('looks back at a period that is over, all of it', async () => {
    const { find, svg } = await render(
      makePeriod({ current: false, days_gone: 30, expected: null, projected: null }),
    )

    expect(text(find('pace-end-label'))).toBe('Spent $1,250.00')
    expect(svg().find('.pace__line').exists()).toBe(true)
  })

  it('has nothing to read for a period that has not begun', async () => {
    const { find, svg, pointAt } = await render(
      makePeriod({ current: false, days_gone: 0, expected: null, projected: null, daily: [] }),
    )

    await pointAt(5)

    expect(find('pace-scrub').exists()).toBe(false)
    expect(find('pace-end-label').exists()).toBe(false)
    expect(svg().find('.pace__line').exists()).toBe(false)
    expect(find('pace-tip').exists()).toBe(false)
  })

  it('draws a single day of spending as a dot', async () => {
    const { find, svg } = await render(
      makePeriod({
        days: 1,
        days_gone: 1,
        daily: [{ day: '2026-09-01', income: '0.00', spent: '40.00' }],
      }),
    )

    expect(svg().find('.pace__area').exists()).toBe(false)
    expect(text(find('pace-end-label'))).toBe('Spent $40.00')
    expect(svg().findAll('.pace__axis text')).toHaveLength(1)
  })

  it('has the same numbers as a table, for the days money was spent', async () => {
    const { find, wrapper } = await render()

    await find('chart-view-table').trigger('click')

    expect(
      wrapper
        .findAll('[data-test="pace-row"]')
        .map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['Sep 1, 2026', '$1,000.00', '$1,000.00'],
      ['Sep 3, 2026', '$84.12', '$1,084.12'],
      ['Sep 18, 2026', '$165.88', '$1,250.00'],
    ])
  })

  it('shows the first days of a long table, and the rest when asked for', async () => {
    const days = Array.from({ length: 20 }, (_, index) => ({
      day: `2026-09-${String(index + 1).padStart(2, '0')}`,
      income: '0.00',
      spent: '10.00',
    }))
    const { find, wrapper } = await render(makePeriod({ days_gone: 20, daily: days }))

    await find('chart-view-table').trigger('click')
    expect(wrapper.findAll('[data-test="pace-row"]')).toHaveLength(12)
    expect(find('chart-table-more').text()).toBe('Show all 20 rows')

    await find('chart-table-more').trigger('click')
    expect(wrapper.findAll('[data-test="pace-row"]')).toHaveLength(20)
    expect(find('chart-table-more').exists()).toBe(false)
  })

  it('says so in the table when nothing has been spent', async () => {
    const { find, wrapper } = await render(makePeriod({ daily: [], days_gone: 0, current: false }))

    await find('chart-view-table').trigger('click')

    expect(wrapper.find('[data-test="pace-table"]').text()).toContain('Nothing has been spent yet.')
  })

  it('reads a day from where it is pointed at even when the chart has no size to measure', async () => {
    const { find, svg } = await render()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    svg().element.dispatchEvent(new MouseEvent('pointermove', { clientX: 52, bubbles: true }))
    await nextTick()

    expect(text(find('pace-tip'))).toContain('Tuesday, September 1')
  })
})
