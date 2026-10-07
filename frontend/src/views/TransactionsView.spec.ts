import { flushPromises } from '@vue/test-utils'

import * as accountsApi from '@/api/accounts'
import type { Account } from '@/api/accounts'
import * as aiApi from '@/api/ai'
import { ApiError } from '@/api/client'
import * as importsApi from '@/api/imports'
import * as api from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useAiStore } from '@/stores/ai'
import { aiOff, makeAiSettings, makeProviders, makeSearchResult } from '@/test/ai'
import { answer } from '@/test/confirm'
import {
  checking,
  coffee,
  groceries,
  latte,
  makeAccount,
  makePage,
  salary,
  savings,
  seedFinance,
  visa,
  wholeFoods,
} from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { checkingImport } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import TransactionsView from '@/views/TransactionsView.vue'
import { emptyFilters } from '@/views/transactions/view'

interface Options {
  role?: 'admin' | 'viewer'
  route?: string
  width?: number
  accounts?: Account[]
  /** AI is set up, as Settings > AI does. It's off unless a test says. */
  ai?: boolean
}

async function render({
  role = 'admin',
  route = '/transactions',
  width = 1280,
  accounts = [checking, savings, visa],
  ai = false,
}: Options = {}) {
  const mounted = await mountWithPlugins(TransactionsView, {
    width,
    route,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      seedFinance({ accounts })
      const store = useAiStore()
      store.providers = makeProviders()
      store.settings = ai ? makeAiSettings() : aiOff
    },
  })
  await flushPromises()
  const { wrapper, router } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const component = (name: string) => wrapper.findComponent({ name })
  const query = () => router.currentRoute.value.query
  /** Waits for the address to change to this, then for the list to load again. */
  async function routeIs(expected: Record<string, string | string[]>) {
    await vi.waitFor(() => {
      expect(query()).toEqual(expected)
    })
    await flushPromises()
  }
  return { ...mounted, find, component, query, routeIs }
}

describe('TransactionsView', () => {
  it('lists the transactions with what they add up to, newest first', async () => {
    const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { wrapper, find } = await render()

    expect(fetch).toHaveBeenCalledWith({
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
    expect(wrapper.findAll('[data-test="transaction-table"] tbody tr')).toHaveLength(3)
    expect(find('totals-count').text()).toBe('3')
    expect(find('transaction-add').exists()).toBe(true)
    expect(find('read-only-notice').exists()).toBe(false)
    expect(find('bulk-bar').exists()).toBe(false)
    expect(find('transaction-list').exists()).toBe(false)
  })

  it('shows what the address asks for', async () => {
    const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([wholeFoods]))
    const { find } = await render({
      route: `/transactions?account=${savings.id}&status=posted&sort=amount`,
    })
    expect(fetch.mock.calls[0]![0]).toMatchObject({
      account_id: [savings.id],
      status: 'posted',
      sort: 'amount',
    })
    expect(find(`filter-chip-account-${savings.id}`).text()).toContain('Rainy day fund')
    expect(find('transaction-filters').text()).toContain('Filters')
  })

  it('shows what one import added, by its file’s name', async () => {
    const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([wholeFoods]))
    const imports = vi.spyOn(importsApi, 'fetchImports').mockResolvedValue([checkingImport])
    vi.spyOn(importsApi, 'fetchSavedFormats').mockResolvedValue([])
    const { find } = await render({ route: `/transactions?import=${checkingImport.id}` })
    expect(fetch.mock.calls[0]![0]).toMatchObject({ import_id: checkingImport.id })
    expect(imports).toHaveBeenCalledOnce()
    expect(find('filter-chip-import').text()).toContain('From harbor-checking.csv')
  })

  it.each([
    [`account=${savings.id}`, savings.id],
    [`account=${visa.id}`, null],
    [`account=${savings.id}&account=${checking.id}`, null],
    ['', null],
  ])('adds to the account being looked at: %s', async (search, expected) => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { find, component } = await render({ route: `/transactions?${search}` })
    await find('transaction-add').trigger('click')
    await flushPromises()
    const dialog = component('TransactionDialog')
    expect(dialog.props('modelValue')).toBe(true)
    expect(dialog.props('transaction')).toBeNull()
    expect(dialog.props('defaultAccount')).toBe(expected)
  })

  it('searches, changes the period and changes the order', async () => {
    const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { component, routeIs } = await render({ route: '/transactions?page=2' })
    const toolbar = component('TransactionToolbar')

    toolbar.vm.$emit('search', 'coffee')
    await routeIs({ q: 'coffee' })
    expect(fetch.mock.calls.at(-1)![0]).toMatchObject({ q: 'coffee', page: 1 })

    toolbar.vm.$emit('period', 'last-month')
    await routeIs({ q: 'coffee', period: 'last-month' })

    toolbar.vm.$emit('sort', 'payee')
    await routeIs({ q: 'coffee', period: 'last-month', sort: 'payee' })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('opens the filters, at the dates when choosing custom dates', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { component, routeIs } = await render({ route: '/transactions?period=this-year' })
    const toolbar = component('TransactionToolbar')
    const filters = () => component('FilterDialog')

    toolbar.vm.$emit('filters', 'dates')
    await flushPromises()
    expect(filters().props()).toMatchObject({ modelValue: true, focus: 'dates' })
    filters().vm.$emit('update:modelValue', false)
    toolbar.vm.$emit('filters')
    await flushPromises()
    expect(filters().props()).toMatchObject({ modelValue: true, focus: null })

    filters().vm.$emit('apply', {
      ...emptyFilters(),
      direction: 'in',
      period: 'custom',
      start: '2026-09-01',
    })
    await routeIs({ direction: 'in', from: '2026-09-01' })
  })

  it('takes filters off from their chips', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { component, routeIs } = await render({
      route: '/transactions?status=posted&direction=in',
    })
    const chips = component('FilterChips')

    chips.vm.$emit('change', { status: null })
    await routeIs({ direction: 'in' })
    chips.vm.$emit('clear')
    await routeIs({})
  })

  it('pages and sorts from the table', async () => {
    const fetch = vi
      .spyOn(api, 'fetchTransactions')
      .mockResolvedValue(makePage(undefined, { total: 120 }))
    const { component, routeIs } = await render()
    component('TransactionTable').vm.$emit('options', { page: 2, pageSize: 50, sort: '-date' })
    await routeIs({ page: '2' })
    expect(fetch.mock.calls.at(-1)![0]).toMatchObject({ page: 2 })
  })

  it('goes to the last page when asked for one past it', async () => {
    const fetch = vi
      .spyOn(api, 'fetchTransactions')
      .mockResolvedValueOnce(makePage([], { total: 60, page: 5 }))
      .mockResolvedValue(makePage([salary], { total: 60, page: 2 }))
    const { find, routeIs } = await render({ route: '/transactions?page=5' })
    await routeIs({ page: '2' })
    expect(fetch.mock.calls.at(-1)![0]).toMatchObject({ page: 2 })
    expect(find('totals-count').text()).toBe('60')
  })

  it('shows only the answer to the latest request', async () => {
    let answerFirst!: (page: api.TransactionPage) => void
    let failSecond!: (error: Error) => void
    vi.spyOn(api, 'fetchTransactions')
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockReturnValueOnce(new Promise((_, reject) => (failSecond = reject)))
      .mockResolvedValueOnce(makePage([salary]))
    const { wrapper, component, find, routeIs } = await render()
    const toolbar = component('TransactionToolbar')

    toolbar.vm.$emit('search', 'acme')
    await routeIs({ q: 'acme' })
    toolbar.vm.$emit('search', 'acme corp')
    await routeIs({ q: 'acme corp' })
    answerFirst(makePage([latte, wholeFoods]))
    failSecond(new Error('Too slow'))
    await flushPromises()

    expect(wrapper.findAll('[data-test="transaction-table"] tbody tr')).toHaveLength(1)
    expect(find('transactions-error').exists()).toBe(false)
    expect(component('TransactionTable').props('loading')).toBe(false)
  })

  it('says when the transactions could not load, and tries again', async () => {
    const fetch = vi
      .spyOn(api, 'fetchTransactions')
      .mockRejectedValueOnce(new ApiError(0, "Can't reach Cashcove."))
      .mockResolvedValue(makePage())
    const { find } = await render()

    expect(find('transactions-error').text()).toContain(
      "Couldn't load the transactions. Can't reach Cashcove.",
    )
    await find('transactions-retry').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('transaction-table').exists()).toBe(true)
  })

  it('shows placeholders while the first page loads', async () => {
    vi.spyOn(api, 'fetchTransactions').mockReturnValue(new Promise(() => undefined))
    const { find } = await render()
    expect(find('transactions-loading').exists()).toBe(true)
    expect(find('transaction-add').exists()).toBe(false)
  })

  it('invites admins to add their first transaction', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([]))
    const { find, component } = await render()

    expect(find('transactions-empty').text()).toContain(
      'Add them by hand, import them from a file, or connect a bank to bring them in.',
    )
    expect(find('transaction-add').exists()).toBe(false)
    expect(find('transaction-search').exists()).toBe(false)
    expect(
      find('transactions-empty')
        .findAll('a')
        .map((link) => link.attributes('href')),
    ).toEqual(['/import', '/connect'])
    await find('transaction-add-first').trigger('click')
    await flushPromises()
    expect(component('TransactionDialog').props('modelValue')).toBe(true)
  })

  it('sends admins to add an account when there are none', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([]))
    const closed = makeAccount({ id: 'account-closed', closed_at: '2026-01-01T00:00:00Z' })
    const { find } = await render({ accounts: [closed] })
    expect(find('transactions-empty').text()).toContain(
      'Transactions go in accounts, so add an account or connect a bank first.',
    )
    expect(find('transactions-accounts').attributes('href')).toBe('/accounts')
    expect(find('transaction-add-first').exists()).toBe(false)
  })

  it('waits for linked accounts to sync when none are kept by hand', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([]))
    const { find } = await render({ accounts: [visa] })
    expect(find('transactions-empty').text()).toContain(
      'Transactions from your linked accounts show up here once they sync.',
    )
    expect(find('transaction-add-first').exists()).toBe(false)
    expect(find('transactions-accounts').exists()).toBe(false)
  })

  it('offers to clear the filters when nothing matches', async () => {
    const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([]))
    const { find, routeIs } = await render({ route: '/transactions?q=zzz' })

    expect(find('transactions-none-match').text()).toContain('No transactions match')
    expect(find('transaction-add').exists()).toBe(true)
    await find('transactions-clear').trigger('click')
    await routeIs({})
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('opens a transaction, and loads again once it changes', async () => {
    const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const fetchAccounts = vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([checking])
    const { component } = await render()
    const infoDialog = () => component('TransactionInfoDialog')
    const dialog = () => component('TransactionDialog')

    component('TransactionTable').vm.$emit('open', wholeFoods)
    await flushPromises()
    expect(infoDialog().props()).toMatchObject({
      modelValue: true,
      transaction: wholeFoods,
      editable: true,
    })

    infoDialog().vm.$emit('saved', wholeFoods)
    await flushPromises()
    infoDialog().vm.$emit('edit', wholeFoods)
    await flushPromises()
    expect(infoDialog().props('modelValue')).toBe(false)
    expect(dialog().props()).toMatchObject({ modelValue: true, transaction: wholeFoods })

    dialog().vm.$emit('saved', wholeFoods)
    await flushPromises()
    dialog().vm.$emit('deleted', wholeFoods)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetchAccounts).toHaveBeenCalledTimes(3)

    dialog().vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(dialog().props('modelValue')).toBe(false)
  })

  it('shows viewers everything without ways to change it', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { find, component } = await render({ role: 'viewer' })

    expect(find('read-only-notice').text()).toContain('Only an admin can add or change them')
    expect(find('transaction-add').exists()).toBe(false)
    expect(component('TransactionTable').props('selectable')).toBe(false)
    expect(component('CategorizeDialog').exists()).toBe(false)
    expect(component('LinkSubscriptionDialog').exists()).toBe(false)
    expect(component('AutomationDialog').exists()).toBe(false)
    component('TransactionTable').vm.$emit('open', latte)
    await flushPromises()
    expect(component('TransactionInfoDialog').props()).toMatchObject({
      modelValue: true,
      transaction: latte,
      editable: false,
    })
    component('TransactionInfoDialog').vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(component('TransactionInfoDialog').props('modelValue')).toBe(false)
  })

  it('tells viewers when there are no transactions yet', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([]))
    const { find } = await render({ role: 'viewer' })
    expect(find('transactions-empty').text()).toContain(
      "An admin hasn't added any transactions yet.",
    )
    expect(find('transactions-empty').find('a, button').exists()).toBe(false)
  })

  describe('with transactions selected', () => {
    async function select(ids: string[]) {
      const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
      vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([checking])
      const rendered = await render()
      rendered.component('TransactionTable').vm.$emit('update:selected', ids)
      await flushPromises()
      return { ...rendered, fetch, bar: () => rendered.component('BulkBar') }
    }

    it('categorizes them together', async () => {
      const { fetch, bar, find, component } = await select([latte.id, wholeFoods.id])
      expect(find('bulk-bar').text()).toContain('2 selected')

      bar().vm.$emit('categorize')
      await flushPromises()
      const dialog = component('CategorizeDialog')
      expect(dialog.props()).toMatchObject({ modelValue: true, ids: [latte.id, wholeFoods.id] })
      dialog.vm.$emit('done')
      dialog.vm.$emit('update:modelValue', false)
      await flushPromises()
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(find('bulk-bar').exists()).toBe(false)
      expect(dialog.props('modelValue')).toBe(false)
    })

    it('links the payments among them to a subscription', async () => {
      const { fetch, bar, find, component } = await select([latte.id, salary.id, wholeFoods.id])
      expect(bar().props()).toMatchObject({ count: 3, payments: 2 })

      bar().vm.$emit('link')
      await flushPromises()
      const dialog = component('LinkSubscriptionDialog')
      // Money coming in isn't a payment, so only the other two can be linked.
      expect(dialog.props()).toMatchObject({
        modelValue: true,
        ids: [latte.id, wholeFoods.id],
        selected: 3,
      })
      const before = fetch.mock.calls.length
      dialog.vm.$emit('done')
      dialog.vm.$emit('update:modelValue', false)
      await flushPromises()
      expect(fetch).toHaveBeenCalledTimes(before + 1)
      expect(find('bulk-bar').exists()).toBe(false)
      expect(dialog.props('modelValue')).toBe(false)
    })

    it('starts an automation from them', async () => {
      const { fetch, bar, find, component } = await select([latte.id, wholeFoods.id])

      bar().vm.$emit('automate')
      await flushPromises()
      const dialog = component('AutomationDialog')
      expect(dialog.props()).toMatchObject({
        modelValue: true,
        automation: null,
        seed: [latte, wholeFoods],
      })
      const before = fetch.mock.calls.length
      dialog.vm.$emit('saved')
      dialog.vm.$emit('update:modelValue', false)
      await flushPromises()
      expect(fetch).toHaveBeenCalledTimes(before + 1)
      expect(find('bulk-bar').exists()).toBe(false)
      expect(dialog.props('modelValue')).toBe(false)
    })

    it('deletes them once confirmed', async () => {
      const remove = vi.spyOn(api, 'deleteTransactions').mockResolvedValue({ count: 2 })
      const { fetch, bar, find } = await select([latte.id, wholeFoods.id])

      bar().vm.$emit('delete')
      await flushPromises()
      expect(confirmRequest.value).toMatchObject({
        title: 'Delete 2 transactions?',
        confirmText: 'Delete transactions',
        tone: 'error',
      })
      await answer(false)
      expect(remove).not.toHaveBeenCalled()
      expect(find('bulk-bar').exists()).toBe(true)

      bar().vm.$emit('delete')
      await flushPromises()
      await answer(true)
      expect(remove).toHaveBeenCalledWith([latte.id, wholeFoods.id])
      expect(notices.value.at(-1)?.text).toBe('Deleted 2 transactions')
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(find('bulk-bar').exists()).toBe(false)
    })

    it('deletes just one', async () => {
      vi.spyOn(api, 'deleteTransactions').mockResolvedValue({ count: 1 })
      const { bar } = await select([latte.id])
      bar().vm.$emit('delete')
      await flushPromises()
      expect(confirmRequest.value).toMatchObject({
        title: 'Delete 1 transaction?',
        confirmText: 'Delete transaction',
      })
      await answer(true)
      expect(notices.value.at(-1)?.text).toBe('Deleted 1 transaction')
    })

    it('clears the selection, and starts afresh with each new view', async () => {
      const { bar, find, component, routeIs } = await select([latte.id])
      bar().vm.$emit('clear')
      await flushPromises()
      expect(find('bulk-bar').exists()).toBe(false)

      component('TransactionTable').vm.$emit('update:selected', [salary.id])
      await flushPromises()
      component('TransactionToolbar').vm.$emit('search', 'acme')
      await routeIs({ q: 'acme' })
      expect(find('bulk-bar').exists()).toBe(false)
    })
  })

  describe('on a phone', () => {
    it('lists transactions by day, with pages to turn', async () => {
      const fetch = vi
        .spyOn(api, 'fetchTransactions')
        .mockResolvedValue(makePage(undefined, { total: 120 }))
      const { find, component, routeIs } = await render({ width: 400 })

      expect(find('transaction-table').exists()).toBe(false)
      expect(component('TransactionList').props('byDay')).toBe(true)
      const pages = component('VPagination')
      expect(pages.props('length')).toBe(3)
      pages.vm.$emit('update:modelValue', 2)
      await routeIs({ page: '2' })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('lists them without days in other orders, and needs no pages for a few', async () => {
      vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
      const { find, component } = await render({ width: 400, route: '/transactions?sort=amount' })
      expect(component('TransactionList').props('byDay')).toBe(false)
      expect(find('transaction-pages').exists()).toBe(false)
    })

    it('shows progress while loading more', async () => {
      vi.spyOn(api, 'fetchTransactions')
        .mockResolvedValueOnce(makePage())
        .mockReturnValue(new Promise(() => undefined))
      const { wrapper, component, routeIs } = await render({ width: 400 })
      component('TransactionToolbar').vm.$emit('search', 'acme')
      await routeIs({ q: 'acme' })
      expect(wrapper.find('.v-progress-linear').exists()).toBe(true)
      expect(component('TransactionList').exists()).toBe(true)
    })
  })
})

describe('TransactionsView, finding transactions by describing them', () => {
  /** What the AI makes of "groceries over $50 last month", with every other filter left out. */
  const found = (changes: Partial<aiApi.SearchFilters> = {}, ignored: string[] = []) =>
    makeSearchResult({ ignored }, { category_ids: [groceries.id], ...changes })

  it('has no way to, and says nothing of AI, until AI is set up', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { find } = await render()

    expect(find('transaction-ai').exists()).toBe(false)
    expect(find('ai-search').exists()).toBe(false)
  })

  it('opens a box to describe them in, from a button, and puts it away again', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { find } = await render({ ai: true })

    expect(find('ai-search').exists()).toBe(false)
    expect(find('transaction-ai').attributes('aria-expanded')).toBe('false')

    await find('transaction-ai').trigger('click')
    await flushPromises()
    expect(find('ai-search').exists()).toBe(true)
    expect(find('transaction-ai').attributes('aria-expanded')).toBe('true')

    await find('transaction-ai').trigger('click')
    await flushPromises()
    expect(find('transaction-ai').attributes('aria-expanded')).toBe('false')
  })

  it('puts the box away from its own close button too', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { find } = await render({ ai: true })
    await find('transaction-ai').trigger('click')
    await flushPromises()

    await find('ai-search-close').trigger('click')
    await flushPromises()

    expect(find('transaction-ai').attributes('aria-expanded')).toBe('false')
  })

  it('shows what the AI found as the tab’s own filters, replacing the ones that were on', async () => {
    const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const ask = vi.spyOn(aiApi, 'searchWithAi').mockResolvedValue(
      found({
        q: 'whole',
        start: '2026-08-01',
        end: '2026-08-31',
        direction: 'out',
        min_amount: '50.00',
        sort: 'amount',
      }),
    )
    const { find, routeIs } = await render({
      ai: true,
      route: '/transactions?direction=in&account=account-savings',
    })
    await find('transaction-ai').trigger('click')
    await flushPromises()

    await find('ai-search-input').find('input').setValue('groceries over $50 last month')
    await find('ai-search-find').trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledWith('groceries over $50 last month', expect.any(String))
    await routeIs({
      q: 'whole',
      category: [groceries.id],
      from: '2026-08-01',
      to: '2026-08-31',
      direction: 'out',
      min: '50.00',
      sort: 'amount',
    })
    expect(fetch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: 'whole',
        category_id: [groceries.id],
        account_id: [],
        direction: 'out',
        start: '2026-08-01',
        end: '2026-08-31',
        min_amount: '50.00',
        sort: 'amount',
      }),
    )
    // The filters it found are chips, which can be taken off.
    expect(find('filter-chips').text()).toContain('Groceries')
    expect(find('ai-search-result').exists()).toBe(true)
  })

  it('keeps the order the list was in when the AI had none to ask for', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    vi.spyOn(aiApi, 'searchWithAi').mockResolvedValue(found({ category_ids: [coffee.id] }))
    const { find, routeIs } = await render({ ai: true, route: '/transactions?sort=payee' })
    await find('transaction-ai').trigger('click')
    await flushPromises()

    await find('ai-search-input').find('input').setValue('coffee')
    await find('ai-search-find').trigger('click')
    await flushPromises()

    await routeIs({
      category: [coffee.id],
      from: '2026-08-01',
      to: '2026-08-31',
      direction: 'out',
      min: '50.00',
      sort: 'payee',
    })
  })

  it('leaves the filters alone, and says so, when there was nothing in it to filter by', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    vi.spyOn(aiApi, 'searchWithAi').mockResolvedValue(
      found({
        category_ids: [],
        start: null,
        end: null,
        direction: null,
        min_amount: null,
      }),
    )
    const { find, query } = await render({ ai: true, route: '/transactions?direction=in' })
    await find('transaction-ai').trigger('click')
    await flushPromises()

    await find('ai-search-input').find('input').setValue('something blue')
    await find('ai-search-find').trigger('click')
    await flushPromises()

    expect(find('ai-search-nothing').exists()).toBe(true)
    expect(query()).toEqual({ direction: 'in' })
  })

  it('is there for a viewer too, since it only picks filters', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage())
    const { find } = await render({ ai: true, role: 'viewer' })

    expect(find('transaction-ai').exists()).toBe(true)
  })

  it('has no box to describe them in when there are no transactions at all', async () => {
    vi.spyOn(api, 'fetchTransactions').mockResolvedValue(makePage([]))
    const { find } = await render({ ai: true })

    expect(find('transaction-ai').exists()).toBe(false)
    expect(find('ai-search').exists()).toBe(false)
  })
})
