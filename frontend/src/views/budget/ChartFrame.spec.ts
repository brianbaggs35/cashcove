import { h } from 'vue'

import { mountWithPlugins } from '@/test/mount'
import ChartFrame from '@/views/budget/ChartFrame.vue'

async function render(withLegend = true) {
  const mounted = await mountWithPlugins(ChartFrame, {
    width: 1280,
    props: { title: 'Spending', description: 'Day by day' },
    slots: {
      ...(withLegend ? { legend: () => h('span', { 'data-test': 'key' }, 'Spent') } : {}),
      chart: () => h('svg', { 'data-test': 'picture' }),
      table: () => h('table', { 'data-test': 'numbers' }),
    },
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('ChartFrame', () => {
  it('shows the chart with its legend first, titled and described', async () => {
    const { find, wrapper } = await render()

    expect(wrapper.find('h3').text()).toBe('Spending')
    expect(wrapper.text()).toContain('Day by day')
    expect(wrapper.find('section').attributes('aria-labelledby')).toBe(
      wrapper.find('h3').attributes('id'),
    )
    expect(find('picture').exists()).toBe(true)
    expect(find('key').exists()).toBe(true)
    expect(find('numbers').exists()).toBe(false)
  })

  it('shows the same numbers as a table, and back', async () => {
    const { find } = await render()

    await find('chart-view-table').trigger('click')
    expect(find('numbers').exists()).toBe(true)
    expect(find('picture').exists()).toBe(false)
    expect(find('key').exists()).toBe(false)

    await find('chart-view-chart').trigger('click')
    expect(find('picture').exists()).toBe(true)
  })

  it('shows a long table a dozen rows at a time, and all of it when asked for', async () => {
    const rowsShown = (limit: number) =>
      h(
        'table',
        { 'data-test': 'numbers' },
        Array.from({ length: Math.min(limit, 30) }, () => h('tr', { 'data-test': 'row' })),
      )
    const mounted = await mountWithPlugins(ChartFrame, {
      width: 1280,
      props: { title: 'Spending', rows: 30 },
      slots: {
        chart: () => h('svg'),
        table: ({ limit }: { limit: number }) => rowsShown(limit),
      },
    })
    const rows = () => mounted.wrapper.findAll('[data-test="row"]')

    await mounted.wrapper.find('[data-test="chart-view-table"]').trigger('click')
    expect(rows()).toHaveLength(12)
    expect(mounted.wrapper.find('[data-test="chart-table-more"]').text()).toBe('Show all 30 rows')

    await mounted.wrapper.find('[data-test="chart-table-more"]').trigger('click')
    expect(rows()).toHaveLength(30)
    expect(mounted.wrapper.find('[data-test="chart-table-more"]').exists()).toBe(false)
  })

  it('has no button to show more for a table that is short', async () => {
    const { find } = await render()

    await find('chart-view-table').trigger('click')

    expect(find('chart-table-more').exists()).toBe(false)
  })

  it('needs no legend or description', async () => {
    const mounted = await mountWithPlugins(ChartFrame, {
      width: 1280,
      props: { title: 'Where it went' },
      slots: { chart: () => h('svg') },
    })

    expect(mounted.wrapper.find('[data-test="chart-legend"]').exists()).toBe(false)
    expect(mounted.wrapper.find('p').exists()).toBe(false)
  })
})
