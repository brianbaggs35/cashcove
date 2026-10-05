import { makeDashboard } from '@/test/dashboard'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import TopPayees from '@/views/dashboard/TopPayees.vue'

async function render(payees = makeDashboard().payees) {
  const { wrapper } = await mountWithPlugins(TopPayees, {
    width: 1280,
    props: { payees },
    beforeMount: () => seedFinance(),
  })
  return wrapper
}

describe('TopPayees', () => {
  it('lists where the most went, with a bar as long as its share of the biggest', async () => {
    const wrapper = await render()

    const rows = wrapper.findAll('[data-test="top-payee"]')
    expect(rows.map((row) => row.text())).toEqual([
      'Whole Foods$420.004 transactions',
      'Blue Bottle$105.501 transaction',
    ])
    expect(rows[0]!.find('.payees__bar').attributes('style')).toContain('width: 100%')
    expect(rows[1]!.find('.payees__bar').attributes('style')).toContain('width: 25.1')
  })

  it('links each payee to what was spent with them this month', async () => {
    const wrapper = await render()

    const link = wrapper.find('[data-test="top-payee"] a')
    const url = new URL(link.attributes('href')!, 'https://cashcove.example')
    expect(url.pathname).toBe('/transactions')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'Whole Foods',
      period: 'this-month',
      direction: 'out',
    })
  })

  it('has nothing to list until money has gone out', async () => {
    const wrapper = await render([])

    expect(wrapper.find('[data-test="empty-state"]').text()).toContain('No spending yet this month')
  })
})
