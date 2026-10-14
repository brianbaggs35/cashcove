import { flushPromises } from '@vue/test-utils'

import type { PaymentPoint } from '@/api/subscriptions'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import PaymentChart from '@/views/subscriptions/PaymentChart.vue'

const history: PaymentPoint[] = [
  { on: '2026-07-15', amount: '14.99' },
  { on: '2026-08-15', amount: '14.99' },
  { on: '2026-09-15', amount: '17.99' },
  { on: '2026-10-15', amount: '12.00' },
]

async function render(points: PaymentPoint[] = history, currency?: string) {
  const { wrapper } = await mountWithPlugins(PaymentChart, {
    props: { history: points, currency },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const plot = () => wrapper.find('.paid__plot')
  /** Points at a place along the plot, from 0 (its left edge) to 1 (its right). */
  const point = async (place: number) => {
    plot().element.dispatchEvent(
      new MouseEvent('pointermove', { clientX: place * 480, bubbles: true }),
    )
    await flushPromises()
  }
  return { wrapper, find, plot, point }
}

describe('PaymentChart', () => {
  it('draws a bar for each payment, with what they average across them', async () => {
    const { wrapper, find } = await render()

    const bars = wrapper.findComponent({ name: 'VSparkline' })
    expect(bars.props('modelValue')).toEqual([14.99, 14.99, 17.99, 12])
    expect(bars.props('min')).toBe(0)
    expect(wrapper.text()).toContain('Each of the latest 4 payments, oldest to newest')
    // The average of the four, to the cent, named in the legend and drawn as a line.
    expect(find('payment-average-key').text()).toBe('Average $14.99')
    expect(find('payment-average').exists()).toBe(true)
    expect(wrapper.find('.paid__axis').text()).toBe('$0$5$10$15$20')
  })

  it('labels the first, the middle and the last, and keeps bars from filling the width when there are few', async () => {
    const { wrapper } = await render()
    expect(wrapper.find('.paid__labels').text()).toBe('Jul 26Sep 26Oct 26')
    expect(wrapper.findComponent({ name: 'VSparkline' }).props('lineWidth')).toBe(36)

    const many = Array.from({ length: 24 }, (_, index) => ({
      on: `2026-10-${String(index + 1).padStart(2, '0')}`,
      amount: '10.00',
    }))
    const { wrapper: crowded } = await render(many)
    expect(crowded.findComponent({ name: 'VSparkline' }).props('lineWidth')).toBe(16)

    const { wrapper: two } = await render(history.slice(0, 2))
    expect(two.find('.paid__labels').text()).toBe('Jul 26Aug 26')
  })

  it('reads a payment as it is pointed at, against the one before, and stops when the pointer leaves', async () => {
    const { find, plot, point } = await render()
    expect(find('payment-tip').exists()).toBe(false)

    await point(0.05)
    expect(find('payment-tip').text()).toContain('Jul 15, 2026')
    expect(find('payment-tip').text()).toContain('$14.99')
    expect(find('payment-tip').text()).toContain('the earliest shown')

    await point(0.3)
    expect(find('payment-tip').text()).toContain('Aug 15, 2026')
    expect(find('payment-tip').text()).toContain('the same as the one before')

    await point(0.6)
    expect(find('payment-tip').text()).toContain('Sep 15, 2026')
    expect(find('payment-tip').text()).toContain('$3.00 more than the one before')

    await point(0.9)
    expect(find('payment-tip').text()).toContain('$5.99 less than the one before')

    await plot().trigger('pointerleave')
    expect(find('payment-tip').exists()).toBe(false)
  })

  it('holds a reading to the chart when the pointer is beyond either end', async () => {
    const { find, point } = await render()

    await point(2)
    expect(find('payment-tip').text()).toContain('Oct 15, 2026')
    await point(-1)
    expect(find('payment-tip').text()).toContain('Jul 15, 2026')
  })

  it('reads each payment as the keyboard moves the scrubber, starting from the latest', async () => {
    const { find } = await render()
    const scrub = find('payment-scrub')
    const value = () => (scrub.element as HTMLInputElement).value

    expect(scrub.attributes('type')).toBe('range')
    expect(scrub.attributes('max')).toBe('3')
    expect(scrub.attributes('aria-valuetext')).toBe(
      'Thursday, October 15, 2026: $12.00, $5.99 less than the one before.',
    )

    await scrub.trigger('focus')
    expect(value()).toBe('3')
    expect(find('payment-tip').text()).toContain('Oct 15, 2026')

    await scrub.setValue(1)
    expect(value()).toBe('1')
    expect(scrub.attributes('aria-valuetext')).toContain('Saturday, August 15, 2026')
    expect(find('payment-tip').text()).toContain('Aug 15, 2026')

    await scrub.trigger('keydown', { key: 'Escape' })
    expect(find('payment-tip').exists()).toBe(false)
    await scrub.setValue(0)
    expect(scrub.attributes('aria-valuetext')).toContain('the earliest shown')
    // With the keyboard gone, it is back to saying what the latest was.
    await scrub.trigger('blur')
    expect(find('payment-tip').exists()).toBe(false)
    expect(scrub.attributes('aria-valuetext')).toContain('October 15, 2026')
  })

  it('shows every payment in a table, the newest first, with how each changed', async () => {
    const { wrapper, find } = await render()
    await find('chart-view-table').trigger('click')

    const rows = wrapper.findAll('[data-test="payment-row"]')
    expect(rows.map((row) => row.find('th').text())).toEqual([
      'Oct 15, 2026',
      'Sep 15, 2026',
      'Aug 15, 2026',
      'Jul 15, 2026',
    ])
    const cells = rows.map((row) => row.findAll('td').map((cell) => cell.text()))
    expect(cells[0]![0]).toBe('$12.00')
    expect(cells[0]![1]).toMatch(/^[-−]\$5\.99$/)
    expect(cells[1]![1]).toBe('+$3.00')
    expect(cells[2]![1]).toBe('$0.00')
    // Nothing to compare the earliest with.
    expect(cells[3]).toEqual(['$14.99', '—'])
  })

  it('shows only the latest rows of a long table until the rest are asked for', async () => {
    const many = Array.from({ length: 24 }, (_, index) => ({
      on: `2026-10-${String(index + 1).padStart(2, '0')}`,
      amount: `${10 + index}.00`,
    }))
    const { wrapper, find } = await render(many)
    await find('chart-view-table').trigger('click')

    expect(wrapper.findAll('[data-test="payment-row"]')).toHaveLength(12)
    await find('chart-table-more').trigger('click')
    expect(wrapper.findAll('[data-test="payment-row"]')).toHaveLength(24)
  })

  it('uses the currency it is given, the household’s otherwise', async () => {
    const { wrapper: canadian, find } = await render(history, 'CAD')
    expect(find('payment-average-key').text()).toBe('Average CA$14.99')
    expect(canadian.find('.paid__axis').text()).toContain('CA$20')

    const { wrapper: household } = await render()
    expect(household.find('.paid__axis').text()).toContain('$20')
    expect(household.find('.paid__axis').text()).not.toContain('CA$')
  })
})
