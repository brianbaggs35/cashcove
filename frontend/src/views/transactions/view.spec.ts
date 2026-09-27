import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import { mountWithPlugins } from '@/test/mount'
import {
  apiQuery,
  copyFilters,
  defaultView,
  emptyFilters,
  filterCount,
  isFiltered,
  queryFromView,
  useTransactionView,
  viewFromQuery,
  type TransactionView,
} from '@/views/transactions/view'

const now = new Date(2026, 8, 20, 12)

function viewWith(changes: Partial<TransactionView['filters']> = {}): TransactionView {
  return { ...defaultView(), filters: { ...emptyFilters(), ...changes } }
}

describe('the transactions view', () => {
  it('starts with every transaction, newest first, 50 to a page', () => {
    expect(defaultView()).toEqual({
      filters: {
        q: '',
        accounts: [],
        categories: [],
        uncategorized: false,
        period: 'all',
        start: null,
        end: null,
        direction: null,
        status: null,
        sources: [],
        min: null,
        max: null,
      },
      sort: '-date',
      page: 1,
      pageSize: 50,
    })
    expect(viewFromQuery({})).toEqual(defaultView())
  })

  it('copies filters without sharing their lists', () => {
    const filters = {
      ...emptyFilters(),
      accounts: ['a'],
      categories: ['c'],
      sources: ['file' as const],
    }
    const copy = copyFilters(filters)
    copy.accounts.push('b')
    copy.categories.push('d')
    copy.sources.push('plaid')
    expect(filters).toMatchObject({ accounts: ['a'], categories: ['c'], sources: ['file'] })
  })

  it('reads everything it shows from the address', () => {
    const view = viewFromQuery({
      q: '  coffee ',
      account: ['account-checking', 'account-visa'],
      category: ['category-coffee', 'none'],
      period: 'last-month',
      direction: 'out',
      status: 'pending',
      source: ['plaid', 'file'],
      min: '10',
      max: '1,250.5',
      sort: 'amount',
      page: '3',
      size: '100',
    })

    expect(view).toEqual({
      filters: {
        q: 'coffee',
        accounts: ['account-checking', 'account-visa'],
        categories: ['category-coffee'],
        uncategorized: true,
        period: 'last-month',
        start: null,
        end: null,
        direction: 'out',
        status: 'pending',
        sources: ['plaid', 'file'],
        min: '10.00',
        max: '1250.50',
      },
      sort: 'amount',
      page: 3,
      pageSize: 100,
    })
  })

  it('reads custom dates, even with only one end', () => {
    expect(viewFromQuery({ from: '2026-09-01', to: '2026-09-15' }).filters).toMatchObject({
      period: 'custom',
      start: '2026-09-01',
      end: '2026-09-15',
    })
    expect(viewFromQuery({ to: '2026-09-15', period: 'this-year' }).filters).toMatchObject({
      period: 'custom',
      start: null,
      end: '2026-09-15',
    })
    expect(viewFromQuery({ from: '2026-09-01', to: 'soon' }).filters).toMatchObject({
      period: 'custom',
      start: '2026-09-01',
      end: null,
    })
  })

  it('ignores whatever in the address makes no sense', () => {
    const view = viewFromQuery({
      q: 'x'.repeat(150),
      account: [null, ''],
      category: 'none',
      from: 'last tuesday',
      period: 'forever',
      direction: 'sideways',
      status: ['posted', 'pending'],
      source: ['plaid', 'fax'],
      min: '-5',
      max: 'lots',
      sort: 'random',
      page: '0',
      size: '30',
    })

    expect(view.filters).toMatchObject({
      accounts: [],
      categories: [],
      uncategorized: true,
      period: 'all',
      start: null,
      end: null,
      direction: null,
      status: 'posted',
      sources: ['plaid'],
      min: null,
      max: null,
    })
    expect(view.filters.q).toHaveLength(100)
    expect([view.sort, view.page, view.pageSize]).toEqual(['-date', 1, 50])
    expect(viewFromQuery({ page: '2.5', size: '500' })).toMatchObject({ page: 1, pageSize: 50 })
    expect(viewFromQuery({ page: '9999999' }).page).toBe(1)
  })

  it('writes only what differs from the defaults into the address', () => {
    expect(queryFromView(defaultView())).toEqual({})
    expect(
      queryFromView({
        filters: {
          ...emptyFilters(),
          q: ' coffee ',
          accounts: ['account-visa'],
          categories: ['category-coffee'],
          uncategorized: true,
          period: 'this-year',
          direction: 'in',
          status: 'posted',
          sources: ['manual'],
          min: '5.00',
          max: '50.00',
        },
        sort: 'payee',
        page: 2,
        pageSize: 25,
      }),
    ).toEqual({
      q: 'coffee',
      account: ['account-visa'],
      category: ['category-coffee', 'none'],
      period: 'this-year',
      direction: 'in',
      status: 'posted',
      source: ['manual'],
      min: '5.00',
      max: '50.00',
      sort: 'payee',
      page: '2',
      size: '25',
    })
  })

  it('writes custom dates in place of a period', () => {
    const custom = viewWith({ period: 'custom', start: '2026-09-01', end: null })
    expect(queryFromView(custom)).toEqual({ from: '2026-09-01' })
    expect(viewFromQuery(queryFromView(custom) as never).filters).toMatchObject({
      period: 'custom',
      start: '2026-09-01',
    })
  })

  it('asks the API for the days a period covers', () => {
    expect(apiQuery(defaultView(), now)).toEqual({
      page: 1,
      page_size: 50,
      q: undefined,
      account_id: [],
      category_id: [],
      uncategorized: undefined,
      direction: undefined,
      status: undefined,
      source: [],
      min_amount: undefined,
      max_amount: undefined,
      sort: '-date',
    })
    expect(apiQuery(viewWith({ period: 'this-month' }), now)).toMatchObject({
      start: '2026-09-01',
      end: '2026-09-20',
    })
    expect(
      apiQuery(viewWith({ period: 'custom', start: null, end: '2026-09-10' }), now),
    ).toMatchObject({ start: undefined, end: '2026-09-10' })
    expect(apiQuery(viewWith({ period: 'custom', start: '2026-09-01', end: null }))).toMatchObject({
      start: '2026-09-01',
      end: undefined,
    })
  })

  it('asks for everything else that narrows the list', () => {
    const query = apiQuery(
      viewWith({
        q: ' latte ',
        accounts: ['account-visa'],
        categories: ['category-coffee'],
        uncategorized: true,
        direction: 'out',
        status: 'pending',
        sources: ['plaid'],
        min: '2.00',
        max: '10.00',
      }),
      now,
    )
    expect(query).toMatchObject({
      q: 'latte',
      account_id: ['account-visa'],
      category_id: ['category-coffee'],
      uncategorized: true,
      direction: 'out',
      status: 'pending',
      source: ['plaid'],
      min_amount: '2.00',
      max_amount: '10.00',
    })
  })

  it('treats amounts in the wrong order as the range between them', () => {
    expect(apiQuery(viewWith({ min: '100.00', max: '20.00' }), now)).toMatchObject({
      min_amount: '20.00',
      max_amount: '100.00',
    })
    expect(apiQuery(viewWith({ min: '20.00' }), now)).toMatchObject({
      min_amount: '20.00',
      max_amount: undefined,
    })
  })

  it('counts the filters beyond search and period', () => {
    expect(filterCount(emptyFilters())).toBe(0)
    expect(
      filterCount({
        ...emptyFilters(),
        accounts: ['a', 'b'],
        categories: ['c'],
        uncategorized: true,
        period: 'custom',
        direction: 'in',
        status: 'posted',
        sources: ['manual', 'file'],
        min: null,
        max: '10.00',
      }),
    ).toBe(10)
    expect(filterCount({ ...emptyFilters(), q: 'coffee', period: 'this-year' })).toBe(0)
  })

  it('knows whether anything narrows the list', () => {
    expect(isFiltered(emptyFilters())).toBe(false)
    expect(isFiltered({ ...emptyFilters(), q: '  ' })).toBe(false)
    expect(isFiltered({ ...emptyFilters(), q: 'coffee' })).toBe(true)
    expect(isFiltered({ ...emptyFilters(), period: 'last-month' })).toBe(true)
    expect(isFiltered({ ...emptyFilters(), status: 'pending' })).toBe(true)
  })
})

describe('useTransactionView', () => {
  async function render(route: string) {
    let state!: ReturnType<typeof useTransactionView>
    const Probe = defineComponent({
      setup() {
        state = useTransactionView()
        return () => h('div')
      },
    })
    const { router } = await mountWithPlugins(Probe, { route })
    return { state, router }
  }

  it('follows the address and changes it, back to the first page', async () => {
    const { state, router } = await render('/transactions?page=4&status=posted')
    expect(state.view.value.page).toBe(4)

    state.update({ sort: 'amount' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ status: 'posted', sort: 'amount' })

    state.update({ page: 2 })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ status: 'posted', sort: 'amount', page: '2' })
    expect(state.view.value.page).toBe(2)
  })

  it('changes some filters and keeps the rest, or clears them all', async () => {
    const { state, router } = await render('/transactions?status=posted&sort=payee')

    state.filter({ direction: 'in' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({
      direction: 'in',
      status: 'posted',
      sort: 'payee',
    })

    state.clear()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: 'payee' })
    expect(router.currentRoute.value.path).toBe('/transactions')
  })
})
