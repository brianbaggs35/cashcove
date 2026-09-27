import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import TotalsBar from '@/views/transactions/TotalsBar.vue'

async function render(totals: object[], total: number) {
  const { wrapper } = await mountWithPlugins(TotalsBar, {
    props: { totals, total },
    beforeMount: () => seedFinance(),
  })
  const texts = (name: string) =>
    wrapper.findAll(`[data-test="${name}"]`).map((tile) => tile.text())
  return { wrapper, texts }
}

describe('TotalsBar', () => {
  it('adds up what matches: how many, money in and out, and what is left', async () => {
    const { wrapper, texts } = await render(
      [{ currency: 'USD', count: 1204, money_in: '2400.00', money_out: '-88.62' }],
      1204,
    )
    expect(texts('totals-count')).toEqual(['1,204'])
    expect(texts('totals-in')).toEqual(['+$2,400.00'])
    expect(texts('totals-out')).toEqual(['-$88.62'])
    expect(texts('totals-net')).toEqual(['+$2,311.38'])
    expect(wrapper.text()).not.toContain('(USD)')
  })

  it('shows nothing coming in without a plus sign', async () => {
    const { texts } = await render(
      [{ currency: 'USD', count: 1, money_in: '0.00', money_out: '-5.00' }],
      1,
    )
    expect(texts('totals-in')).toEqual(['$0.00'])
    expect(texts('totals-net')).toEqual(['-$5.00'])
  })

  it('keeps currencies apart, the household one first', async () => {
    const { wrapper, texts } = await render(
      [
        { currency: 'EUR', count: 1, money_in: '0.00', money_out: '-10.00' },
        { currency: 'USD', count: 2, money_in: '20.00', money_out: '-5.00' },
        { currency: 'CAD', count: 1, money_in: '7.00', money_out: '0.00' },
      ],
      4,
    )
    expect(texts('totals-net')).toEqual(['+$15.00', '+CA$7.00', '-€10.00'])
    expect(wrapper.text()).toContain('Money in (USD)')
    expect(wrapper.text()).toContain('Net (EUR)')
  })
})
