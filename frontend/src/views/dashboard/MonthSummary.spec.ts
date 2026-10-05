import { makeDashboard, makeMonth } from '@/test/dashboard'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import MonthSummary from '@/views/dashboard/MonthSummary.vue'

async function render(changes = {}) {
  const { wrapper } = await mountWithPlugins(MonthSummary, {
    width: 1280,
    props: { dashboard: makeDashboard(changes) },
    beforeMount: () => seedFinance(),
  })
  const tile = (name: string) => wrapper.find(`[data-test="month-${name}"]`)
  return { wrapper, tile }
}

describe('MonthSummary', () => {
  it('names the month and how far through it the household is', async () => {
    const { wrapper } = await render()

    expect(wrapper.find('[data-test="month-title"]').text()).toBe('September 2026')
    expect(wrapper.find('[data-test="month-day"]').text()).toBe('Day 20 of 30')
    const progress = wrapper.find('[role="progressbar"][aria-label]')
    expect(progress.attributes('aria-label')).toBe('How much of the month has gone')
    expect(progress.attributes('aria-valuenow')).toBe(String((20 / 30) * 100))
  })

  it('compares income, spending and what is left with the same days last month', async () => {
    const { tile } = await render()

    expect(tile('income').text()).toContain('$2,400.00')
    expect(tile('income').text()).toContain('$100.00 more than this time last month')
    expect(tile('spent').text()).toContain('$1,250.00')
    expect(tile('spent').text()).toContain('$150.00 less than this time last month')
    expect(tile('saved').text()).toContain('$1,150.00')
    expect(tile('saved').text()).toContain('$250.00 more than this time last month')
  })

  it('shows what is good news in green and what is bad in red, whichever way it moved', async () => {
    const { tile } = await render()
    const tone = (name: string) => tile(name).find('[data-test="month-change"]').classes()

    // More income is good; less spending is good.
    expect(tone('income')).toContain('text-success')
    expect(tone('spent')).toContain('text-success')

    const worse = await render({
      month: makeMonth({ income: '2000.00', spent: '1500.00' }),
      previous: { income: '2300.00', spent: '1400.00' },
    })
    expect(worse.tile('income').find('[data-test="month-change"]').classes()).toContain(
      'text-error',
    )
    expect(worse.tile('spent').find('[data-test="month-change"]').classes()).toContain('text-error')
  })

  it('says so when nothing is different', async () => {
    const { tile } = await render({
      month: makeMonth({ income: '2300.00', spent: '1400.00' }),
      previous: { income: '2300.00', spent: '1400.00' },
    })

    expect(tile('income').text()).toContain('The same as this time last month')
    expect(tile('income').find('[data-test="month-change"]').classes()).toContain(
      'text-medium-emphasis',
    )
  })

  it('shows overspending as a negative amount in red', async () => {
    const { tile } = await render({ month: makeMonth({ income: '100.00', spent: '350.00' }) })

    const saved = tile('saved').find('[data-test="month-value"]')
    expect(saved.text()).toBe('-$250.00')
    expect(saved.classes()).toContain('text-error')
    expect(tile('income').find('[data-test="month-value"]').classes()).not.toContain('text-error')
  })

  it('draws how spending has built up through the month, once there is more than a day of it', async () => {
    const { wrapper } = await render()

    expect(wrapper.find('[data-test="month-pace"]').exists()).toBe(true)
    // A line and the faint area under it.
    expect(wrapper.findAll('[data-test="month-pace"] svg')).toHaveLength(2)
    expect(wrapper.find('[data-test="month-pace"]').attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.find('[data-test="month-pace"] [aria-hidden="true"]').exists()).toBe(true)

    const first = await render({ days_gone: 1 })
    expect(first.wrapper.find('[data-test="month-pace"]').exists()).toBe(false)
  })
})
