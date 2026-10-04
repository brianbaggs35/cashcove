import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/budget'
import type { BudgetTransaction, BudgetTransactionPage } from '@/api/budget'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { makeBudgetTransaction, makeSource } from '@/test/budgets'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import BudgetTransactions from '@/views/budget/BudgetTransactions.vue'

const salary = makeBudgetTransaction({
  id: 'transaction-salary',
  date: '2026-09-15',
  payee: 'Acme Corp',
  amount: '2400.00',
  category_id: 'category-paycheck',
  kind: 'income',
  via: 'automation',
  source_id: 'source-rule',
})
const rent = makeBudgetTransaction({
  id: 'transaction-rent',
  payee: 'Parkside',
  amount: '-1850.00',
  category_id: null,
  via: 'transaction',
  source_id: null,
})
const shop = makeBudgetTransaction()
const sources = [
  makeSource(),
  makeSource({ id: 'source-rule', type: 'automation', name: 'Paycheck rule' }),
]

function page(items: BudgetTransaction[], total = items.length): BudgetTransactionPage {
  return { items, total }
}

async function render(props: Record<string, unknown> = {}, items = [salary, rent, shop]) {
  const fetch = vi.spyOn(api, 'fetchBudgetTransactions').mockResolvedValue(page(items))
  const mounted = await mountWithPlugins(BudgetTransactions, {
    width: 1280,
    props: {
      budgetId: 'budget-monthly',
      budgetName: 'Household',
      on: '2026-09-01',
      sources,
      removed: 0,
      readonly: false,
      version: 0,
      ...props,
    },
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  const rows = () => mounted.wrapper.findAll('[data-test="budget-transaction"]')
  return { ...mounted, fetch, find, rows }
}

const text = (element: { text: () => string }) => element.text().replace(/\s+/g, ' ')
const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)

describe('BudgetTransactions', () => {
  it('lists what counts in the period, and why each does', async () => {
    const { fetch, rows } = await render()

    expect(fetch).toHaveBeenCalledWith('budget-monthly', {
      on: '2026-09-01',
      today: day,
      kind: undefined,
      removed: undefined,
      page: 1,
      pageSize: 10,
    })
    expect(rows().map(text)).toEqual([
      'Acme Corp+$2,400.00Sep 15, 2026 · Everyday checking · PaycheckCounts as incomeRule: Paycheck rule',
      'Parkside-$1,850.00Sep 3, 2026 · Everyday checking · UncategorizedCounts as spendingLinked by hand',
      'Whole Foods-$84.12Sep 3, 2026 · Everyday checking · GroceriesCounts as spendingCategory: Groceries',
    ])
  })

  it('names what counts it, even when that is no longer there', async () => {
    const { rows } = await render({}, [
      makeBudgetTransaction({ via: 'automation', source_id: 'gone' }),
      makeBudgetTransaction({ id: 'two', via: 'subscription', source_id: 'gone' }),
      makeBudgetTransaction({ id: 'three', via: 'category', source_id: 'gone' }),
      makeBudgetTransaction({ id: 'four', via: 'account', source_id: 'gone', account_id: 'x' }),
    ])

    expect(rows().map((row) => text(row.find('[data-test="transaction-reason"]')))).toEqual([
      'A rule',
      'A subscription',
      'A category',
      'An account',
    ])
    expect(text(rows()[3]!)).toContain('Deleted account')
  })

  it('narrows to income, spending, or what was taken off', async () => {
    const { fetch, find } = await render({ removed: 2 })
    expect(find('filter-removed').text()).toBe('Taken off (2)')

    await find('filter-income').trigger('click')
    await flushPromises()
    await find('filter-spending').trigger('click')
    await flushPromises()
    await find('filter-removed').trigger('click')
    await flushPromises()

    expect(fetch.mock.calls.map(([, query]) => [query.kind, query.removed, query.page])).toEqual([
      [undefined, undefined, 1],
      ['income', undefined, 1],
      ['spending', undefined, 1],
      [undefined, true, 1],
    ])
  })

  it('takes a transaction off the budget', async () => {
    const unlink = vi.spyOn(api, 'unlinkBudgetTransaction').mockResolvedValue(undefined)
    const { wrapper, fetch, rows } = await render()
    expect(rows()[2]!.find('[data-test="take-off"]').attributes('aria-label')).toBe(
      'Take Whole Foods off Household',
    )

    await rows()[2]!.find('[data-test="take-off"]').trigger('click')
    await flushPromises()

    expect(unlink).toHaveBeenCalledWith('budget-monthly', 'transaction-groceries')
    expect(notices.value.at(-1)?.text).toBe('Took Whole Foods off Household')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('puts a transaction that was taken off back', async () => {
    const link = vi.spyOn(api, 'linkBudgetTransactions').mockResolvedValue({ count: 1 })
    const { wrapper, find, rows } = await render()
    await find('filter-removed').trigger('click')
    await flushPromises()

    await rows()[2]!.find('[data-test="put-back"]').trigger('click')
    await flushPromises()

    expect(link).toHaveBeenCalledWith('budget-monthly', ['transaction-groceries'], 'spending')
    expect(notices.value.at(-1)?.text).toBe('Put Whole Foods back on Household')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('says what went wrong with a change, and changes nothing', async () => {
    vi.spyOn(api, 'unlinkBudgetTransaction').mockRejectedValue(
      new ApiError(404, 'That transaction is gone.'),
    )
    const { wrapper, find, rows } = await render()

    await rows()[0]!.find('[data-test="take-off"]').trigger('click')
    await flushPromises()

    expect(find('transactions-error').text()).toContain('That transaction is gone.')
    expect(find('transactions-retry').exists()).toBe(false)
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('has nothing to change for viewers', async () => {
    const { find } = await render({ readonly: true })

    expect(find('take-off').exists()).toBe(false)
    expect(find('put-back').exists()).toBe(false)
  })

  it.each([
    ['all', 'Nothing counts toward this budget in this period yet.'],
    ['income', 'No income counts in this period.'],
    ['spending', 'No spending counts in this period.'],
    ['removed', 'Nothing was taken off in this period.'],
  ])('says so when nothing counts under %s', async (filter, message) => {
    const { find, wrapper } = await render({}, [])

    await find(`filter-${filter}`).trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="transactions-empty"]').text()).toContain(message)
  })

  it('shows placeholders until the first answer', async () => {
    vi.spyOn(api, 'fetchBudgetTransactions').mockReturnValue(new Promise(() => undefined))
    const mounted = await mountWithPlugins(BudgetTransactions, {
      width: 1280,
      props: {
        budgetId: 'budget-monthly',
        budgetName: 'Household',
        on: '2026-09-01',
        sources,
        removed: 0,
        readonly: false,
        version: 0,
      },
      beforeMount: () => seedFinance(),
    })

    expect(mounted.wrapper.find('[data-test="transactions-loading"]').exists()).toBe(true)
  })

  it('says when they could not load, and tries again', async () => {
    const fetch = vi
      .spyOn(api, 'fetchBudgetTransactions')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(page([shop]))
    const mounted = await mountWithPlugins(BudgetTransactions, {
      width: 1280,
      props: {
        budgetId: 'budget-monthly',
        budgetName: 'Household',
        on: '2026-09-01',
        sources,
        removed: 0,
        readonly: false,
        version: 0,
      },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()
    const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)

    expect(find('transactions-error').text()).toContain("Couldn't load the transactions. Offline")
    await find('transactions-retry').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('transactions-error').exists()).toBe(false)
    expect(mounted.wrapper.findAll('[data-test="budget-transaction"]')).toHaveLength(1)
  })

  it('loads again for another budget, period or a change made elsewhere, from the first page', async () => {
    const { wrapper, fetch } = await render()

    await wrapper.setProps({ on: '2026-08-01' })
    await flushPromises()
    await wrapper.setProps({ budgetId: 'budget-yearly' })
    await flushPromises()
    await wrapper.setProps({ version: 1 })
    await flushPromises()

    expect(fetch.mock.calls.map(([id, query]) => [id, query.on])).toEqual([
      ['budget-monthly', '2026-09-01'],
      ['budget-monthly', '2026-08-01'],
      ['budget-yearly', '2026-08-01'],
      ['budget-yearly', '2026-08-01'],
    ])
  })

  it('pages through what counts', async () => {
    const fetch = vi.spyOn(api, 'fetchBudgetTransactions').mockResolvedValue(page([shop], 25))
    const mounted = await mountWithPlugins(BudgetTransactions, {
      width: 1280,
      props: {
        budgetId: 'budget-monthly',
        budgetName: 'Household',
        on: '2026-09-01',
        sources,
        removed: 0,
        readonly: false,
        version: 0,
      },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    mounted.wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 3)
    await flushPromises()

    expect(fetch.mock.calls.map(([, query]) => query.page)).toEqual([1, 3])
  })

  it('goes back to the last page when the one it was on has nothing left', async () => {
    const fetch = vi
      .spyOn(api, 'fetchBudgetTransactions')
      .mockResolvedValueOnce(page([shop], 25))
      .mockResolvedValueOnce(page([], 10))
      .mockResolvedValue(page([shop], 10))
    const mounted = await mountWithPlugins(BudgetTransactions, {
      width: 1280,
      props: {
        budgetId: 'budget-monthly',
        budgetName: 'Household',
        on: '2026-09-01',
        sources,
        removed: 0,
        readonly: false,
        version: 0,
      },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    mounted.wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2)
    await flushPromises()

    expect(fetch.mock.calls.map(([, query]) => query.page)).toEqual([1, 2, 1])
  })

  it('only shows the answer to the latest request', async () => {
    const answers: ((value: BudgetTransactionPage) => void)[] = []
    vi.spyOn(api, 'fetchBudgetTransactions').mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve)
        }),
    )
    const mounted = await mountWithPlugins(BudgetTransactions, {
      width: 1280,
      props: {
        budgetId: 'budget-monthly',
        budgetName: 'Household',
        on: '2026-09-01',
        sources,
        removed: 0,
        readonly: false,
        version: 0,
      },
      beforeMount: () => seedFinance(),
    })
    await mounted.wrapper.setProps({ version: 1 })

    answers[1]!(page([salary]))
    await flushPromises()
    answers[0]!(page([shop, rent]))
    await flushPromises()

    expect(
      mounted.wrapper
        .findAll('[data-test="budget-transaction"]')
        .map((row) => row.find('[data-test="transaction-payee"]').text()),
    ).toEqual(['Acme Corp'])
  })

  it('ignores a failure of a request that a newer one replaced', async () => {
    const answers: {
      resolve: (value: BudgetTransactionPage) => void
      reject: (e: Error) => void
    }[] = []
    vi.spyOn(api, 'fetchBudgetTransactions').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answers.push({ resolve, reject })
        }),
    )
    const mounted = await mountWithPlugins(BudgetTransactions, {
      width: 1280,
      props: {
        budgetId: 'budget-monthly',
        budgetName: 'Household',
        on: '2026-09-01',
        sources,
        removed: 0,
        readonly: false,
        version: 0,
      },
      beforeMount: () => seedFinance(),
    })
    await mounted.wrapper.setProps({ version: 1 })

    answers[1]!.resolve(page([salary]))
    await flushPromises()
    answers[0]!.reject(new Error('Too slow'))
    await flushPromises()

    expect(mounted.wrapper.find('[data-test="transactions-error"]').exists()).toBe(false)
    expect(mounted.wrapper.findAll('[data-test="budget-transaction"]')).toHaveLength(1)
  })
})
