import { flushPromises } from '@vue/test-utils'

import * as accountsApi from '@/api/accounts'
import * as billsApi from '@/api/bills'
import * as budgetApi from '@/api/budget'
import * as categoriesApi from '@/api/categories'
import { ApiError } from '@/api/client'
import * as dashboardApi from '@/api/dashboard'
import * as subscriptionsApi from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import { useConnectionsStore } from '@/stores/connections'
import { makeBudget } from '@/test/budgets'
import { fidelity } from '@/test/connections'
import { makeDashboard } from '@/test/dashboard'
import {
  checking,
  latte,
  makeGroups,
  makePage,
  savings,
  seedFinance,
  wholeFoods,
} from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import * as dates from '@/utils/dates'
import DashboardView from '@/views/DashboardView.vue'

interface Options {
  role?: 'admin' | 'viewer'
  accounts?: accountsApi.Account[]
  dashboard?: dashboardApi.Dashboard
}

/** What the view loads besides the dashboard itself. */
function stubLoads(accounts = [checking, savings]) {
  vi.spyOn(dates, 'todayIso').mockReturnValue('2026-09-20')
  const fetchTransactions = vi
    .spyOn(transactionsApi, 'fetchTransactions')
    .mockResolvedValue(makePage([latte, wholeFoods]))
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue(accounts)
  vi.spyOn(budgetApi, 'fetchBudgets').mockResolvedValue([makeBudget()])
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([
    makeSubscription({ next_due_date: '2026-09-23' }),
  ])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([makeBill({ next_due_date: '2026-09-19' })])
  vi.spyOn(categoriesApi, 'fetchCategories').mockResolvedValue(makeGroups())
  return { fetchTransactions }
}

async function render({
  role = 'admin',
  accounts = [checking, savings],
  dashboard = makeDashboard(),
}: Options = {}) {
  const { fetchTransactions } = stubLoads(accounts)
  const fetchDashboard = vi.spyOn(dashboardApi, 'fetchDashboard').mockResolvedValue(dashboard)
  const mounted = await mountWithPlugins(DashboardView, {
    width: 1280,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find, fetchDashboard, fetchTransactions }
}

describe('DashboardView', () => {
  it('shows how the household is doing, from this month back and across its accounts', async () => {
    const { wrapper, find, fetchDashboard, fetchTransactions } = await render()

    expect(wrapper.find('h1').text()).toBe('Dashboard')
    expect(fetchDashboard).toHaveBeenCalledWith('2026-09-20')
    expect(fetchTransactions).toHaveBeenCalledWith({ page_size: 6 })
    for (const part of [
      'net-worth',
      'month-summary',
      'cash-flow',
      'spending-breakdown',
      'budget-progress',
      'coming-up',
      'top-payees',
      'recent-transactions',
    ]) {
      expect(find(part).exists(), part).toBe(true)
    }
    expect(find('net-worth-total').text()).toBe('$14,950.18')
    expect(find('month-title').text()).toBe('September 2026')
    expect(wrapper.findAll('[data-test="recent-transaction"]')).toHaveLength(2)
    expect(find('dashboard-loading').exists()).toBe(false)
  })

  it('lists the bills and subscriptions due soon, the overdue first', async () => {
    const { wrapper } = await render()

    const items = wrapper.findAll('[data-test="coming-up-item"]').map((item) => item.text())
    expect(items).toEqual([
      expect.stringContaining('City PowerOverdue by 1 day'),
      expect.stringContaining('StreamflixDue in 3 days'),
    ])
  })

  it('points out what needs attention', async () => {
    const { find } = await render({
      accounts: [checking],
      dashboard: makeDashboard({ uncategorized: 5 }),
    })
    useConnectionsStore().connections = [fidelity]
    await flushPromises()

    expect(find('attention-uncategorized').text()).toContain('5 transactions have no category yet.')
    expect(find('attention-banks').exists()).toBe(true)
  })

  it('notes the currencies it converted, or could not', async () => {
    const converted = await render({
      dashboard: makeDashboard({ converted: ['EUR', 'GBP'] }),
    })
    expect(converted.find('dashboard-converted').text()).toContain(
      'Amounts in EUR, GBP are converted to USD at each day',
    )
    expect(converted.find('dashboard-unavailable').exists()).toBe(false)

    const missing = await render({ dashboard: makeDashboard({ unavailable: ['JPY'] }) })
    expect(missing.find('dashboard-unavailable').text()).toContain(
      "There's no exchange rate for JPY, so those transactions aren't counted.",
    )
    expect(missing.find('dashboard-converted').exists()).toBe(false)
    expect(missing.wrapper.text()).toContain("isn't counted as income or spending")
  })

  it('shows placeholders until it has loaded', async () => {
    stubLoads()
    vi.spyOn(dashboardApi, 'fetchDashboard').mockReturnValue(new Promise(() => undefined))

    const { wrapper } = await mountWithPlugins(DashboardView, { width: 1280 })
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="month-summary"]').exists()).toBe(false)
  })

  it('says when it cannot load, and tries again', async () => {
    stubLoads()
    const fetchDashboard = vi
      .spyOn(dashboardApi, 'fetchDashboard')
      .mockRejectedValue(new ApiError(503, 'The database is down.'))
    const { wrapper } = await mountWithPlugins(DashboardView, { width: 1280 })
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-error"]').text()).toContain(
      "Couldn't load your dashboard. The database is down.",
    )

    fetchDashboard.mockResolvedValue(makeDashboard())
    await wrapper.find('[data-test="dashboard-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="month-summary"]').exists()).toBe(true)
  })

  it('says when the accounts under it cannot be loaded, and tries them again', async () => {
    stubLoads()
    vi.spyOn(dashboardApi, 'fetchDashboard').mockResolvedValue(makeDashboard())
    const fetchAccounts = vi
      .spyOn(accountsApi, 'fetchAccounts')
      .mockRejectedValue(new ApiError(503, 'The database is down.'))
    const { wrapper } = await mountWithPlugins(DashboardView, { width: 1280 })
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-error"]').text()).toContain(
      "Couldn't load your dashboard. The database is down.",
    )
    expect(wrapper.find('[data-test="dashboard-loading"]').exists()).toBe(false)

    fetchAccounts.mockResolvedValue([checking])
    await wrapper.find('[data-test="dashboard-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="month-summary"]').exists()).toBe(true)
  })

  it('welcomes an admin with no accounts yet, with ways to get some', async () => {
    const { find } = await render({ accounts: [] })

    expect(find('dashboard-welcome').text()).toContain('Your dashboard starts with an account')
    expect(find('dashboard-add-account').attributes('href')).toBe('/accounts')
    expect(
      find('dashboard-welcome')
        .findAll('a')
        .map((link) => link.attributes('href')),
    ).toEqual(['/accounts', '/import', '/connect'])
    expect(find('month-summary').exists()).toBe(false)
  })

  it('tells a viewer with no accounts that an admin has to add them', async () => {
    const { find } = await render({ accounts: [], role: 'viewer' })

    expect(find('dashboard-welcome').text()).toContain("An admin hasn't added any accounts yet.")
    expect(find('dashboard-add-account').exists()).toBe(false)
  })
})
