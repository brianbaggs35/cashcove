import { flushPromises } from '@vue/test-utils'

import { click, page } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'
import TransactionToolbar from '@/views/transactions/TransactionToolbar.vue'
import { emptyFilters } from '@/views/transactions/view'

async function render(filterCount = 0) {
  const mounted = await mountWithPlugins(TransactionToolbar, {
    width: 1280,
    props: { filters: emptyFilters(), sort: '-date', filterCount },
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find, search: find('transaction-search').find('input') }
}

describe('TransactionToolbar', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('searches once typing pauses', async () => {
    const { wrapper, search } = await render()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await search.setValue('cof')
    await search.setValue('coffee ')
    vi.advanceTimersByTime(299)
    expect(wrapper.emitted('search')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(wrapper.emitted('search')).toEqual([['coffee']])
  })

  it('searches straight away on Enter, and clears', async () => {
    const { wrapper, search } = await render()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await search.setValue(' latte')
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('search')).toEqual([['latte']])
    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('search')).toHaveLength(1)

    await wrapper.find('.v-field__clearable .v-icon').trigger('click')
    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('search')?.at(-1)).toEqual([''])
  })

  it('follows a search changed elsewhere, e.g. going back', async () => {
    const { wrapper, search } = await render()
    await wrapper.setProps({ filters: { ...emptyFilters(), q: 'rent' } })
    expect((search.element as HTMLInputElement).value).toBe('rent')

    // Typing a trailing space doesn't get undone by the search it started.
    await search.setValue('rent ')
    await wrapper.setProps({ filters: { ...emptyFilters(), q: 'rent' } })
    expect((search.element as HTMLInputElement).value).toBe('rent ')
  })

  it('picks a period, or custom dates in the filters', async () => {
    const { wrapper } = await render()
    const period = wrapper.findComponent({ name: 'VSelect' })

    period.vm.$emit('update:modelValue', 'last-month')
    period.vm.$emit('update:modelValue', 'custom')
    expect(wrapper.emitted('period')).toEqual([['last-month']])
    expect(wrapper.emitted('filters')).toEqual([['dates']])
  })

  it('opens the filters, showing how many are on', async () => {
    const { wrapper, find } = await render(3)
    expect(wrapper.find('.v-badge__badge').text()).toBe('3')
    await find('transaction-filters').trigger('click')
    expect(wrapper.emitted('filters')).toEqual([[]])
  })

  it('hides the count when no filters are on', async () => {
    const { wrapper } = await render(0)
    expect(wrapper.find('.v-badge__badge').isVisible()).toBe(false)
  })

  it('changes the order from a menu on phones', async () => {
    const { wrapper, find } = await render()
    await find('transaction-sort').trigger('click')
    await flushPromises()
    expect(
      page()
        .findAll('.v-overlay--active .v-list-item')
        .map((item) => item.text()),
    ).toEqual([
      'Newest first',
      'Oldest first',
      'Most money in first',
      'Most money out first',
      'Payee A to Z',
      'Payee Z to A',
    ])
    await click('.v-overlay--active [data-test="transaction-sort--amount"]')
    expect(wrapper.emitted('sort')).toEqual([['-amount']])
  })
})
