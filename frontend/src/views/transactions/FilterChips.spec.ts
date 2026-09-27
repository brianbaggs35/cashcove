import { checking, coffee, seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import FilterChips from '@/views/transactions/FilterChips.vue'
import { emptyFilters, type TransactionFilters } from '@/views/transactions/view'

async function render(changes: Partial<TransactionFilters>) {
  const { wrapper } = await mountWithPlugins(FilterChips, {
    props: { filters: { ...emptyFilters(), ...changes } },
    beforeMount: () => seedFinance(),
  })
  const chip = (key: string) => wrapper.find(`[data-test="filter-chip-${key}"]`)
  const labels = () =>
    wrapper.findAll('.v-chip').map((item) => item.text().replace(/\s+/g, ' ').trim())
  return { wrapper, chip, labels }
}

describe('FilterChips', () => {
  it('shows nothing when nothing narrows the list', async () => {
    const { wrapper } = await render({ q: 'coffee', period: 'this-year' })
    expect(wrapper.find('[data-test="filter-chips"]').exists()).toBe(false)
  })

  it('shows each filter as a chip', async () => {
    const { labels } = await render({
      accounts: [checking.id, 'account-gone'],
      uncategorized: true,
      categories: [coffee.id, 'category-gone'],
      period: 'custom',
      start: '2026-09-01',
      end: '2026-09-15',
      direction: 'in',
      status: 'pending',
      sources: ['manual', 'plaid', 'file'],
      min: '5.00',
      max: '50.00',
    })

    expect(labels()).toEqual([
      'Everyday checking',
      'Deleted account',
      'Uncategorized',
      '☕ Coffee',
      'Deleted category',
      'Sep 1 – 15, 2026',
      'Money in',
      'Pending',
      'Added by hand',
      'From the bank',
      'Imported from a file',
      '$5.00 to $50.00',
    ])
  })

  it.each<[Partial<TransactionFilters>, string]>([
    [{ direction: 'out', status: 'posted' }, 'Money out Posted'],
    [{ min: '5.00' }, 'At least $5.00'],
    [{ max: '50.00' }, 'At most $50.00'],
    [{ period: 'custom', start: '2026-09-01', end: null }, 'From Sep 1, 2026'],
    [{ period: 'custom', start: null, end: '2026-09-15' }, 'Until Sep 15, 2026'],
  ])('describes %o', async (filters, expected) => {
    const { labels } = await render(filters)
    expect(labels().join(' ')).toBe(expected)
  })

  it('removes one filter at a time, or all of them', async () => {
    const { wrapper, chip } = await render({
      accounts: [checking.id, 'account-gone'],
      categories: [coffee.id],
      uncategorized: true,
      period: 'custom',
      start: '2026-09-01',
      direction: 'in',
      status: 'posted',
      sources: ['plaid', 'file'],
      min: '5.00',
    })
    const close = async (key: string) => chip(key).find('.v-chip__close').trigger('click')
    expect(chip('amount').find('.v-chip__close').attributes('aria-label')).toBe(
      'Remove At least $5.00',
    )

    await close(`account-${checking.id}`)
    await close('uncategorized')
    await close(`category-${coffee.id}`)
    await close('dates')
    await close('direction')
    await close('status')
    await close('source-plaid')
    await close('amount')
    expect(wrapper.emitted('change')).toEqual([
      [{ accounts: ['account-gone'] }],
      [{ uncategorized: false }],
      [{ categories: [] }],
      [{ period: 'all', start: null, end: null }],
      [{ direction: null }],
      [{ status: null }],
      [{ sources: ['file'] }],
      [{ min: null, max: null }],
    ])

    await wrapper.find('[data-test="filter-chips-clear"]').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })
})
