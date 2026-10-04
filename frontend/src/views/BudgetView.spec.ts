import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/budget'
import type { Budget, BudgetHistory, BudgetPeriodView } from '@/api/budget'
import { ApiError } from '@/api/client'
import * as transactionsApi from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import { makeBudget, makeHistory, makePeriod, makeSource } from '@/test/budgets'
import { makePage, seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import BudgetView from '@/views/BudgetView.vue'

const monthly = makeBudget()
const weekly = makeBudget({
  id: 'budget-weekly',
  name: 'Spending money',
  period: 'weekly',
  current: {
    start: '2026-09-20',
    end: '2026-09-26',
    amount: '150.00',
    income: '0.00',
    spent: '40.00',
  },
})

function periodOf(budget: Budget, changes: Partial<BudgetPeriodView> = {}): BudgetPeriodView {
  return makePeriod({ budget, ...changes })
}

interface Options {
  role?: 'admin' | 'viewer'
  route?: string
  budgets?: Budget[]
  period?: (budget: Budget) => BudgetPeriodView
}

async function render({
  role = 'admin',
  route = '/budget',
  budgets = [monthly, weekly],
  period = (budget) => periodOf(budget),
}: Options = {}) {
  const fetchBudgets = vi.spyOn(api, 'fetchBudgets').mockResolvedValue(budgets)
  const fetchPeriod = vi
    .spyOn(api, 'fetchBudgetPeriod')
    .mockImplementation((id) => Promise.resolve(period(budgets.find((item) => item.id === id)!)))
  const fetchHistory = vi
    .spyOn(api, 'fetchBudgetHistory')
    .mockResolvedValue({ periods: makeHistory(), converted: [], unavailable: [] })
  const fetchTransactions = vi
    .spyOn(api, 'fetchBudgetTransactions')
    .mockResolvedValue({ items: [], total: 0 })
  vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(makePage([]))
  const mounted = await mountWithPlugins(BudgetView, {
    width: 1280,
    route,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  const component = (name: string) => mounted.wrapper.findComponent({ name })
  const query = () => mounted.router.currentRoute.value.query
  /** Waits for the address to change to this, then for what it shows to load. */
  const routeIs = async (expected: Record<string, string>) => {
    await vi.waitFor(() => {
      expect(query()).toEqual(expected)
    })
    await flushPromises()
  }
  return {
    ...mounted,
    find,
    component,
    query,
    routeIs,
    fetchBudgets,
    fetchPeriod,
    fetchHistory,
    fetchTransactions,
  }
}

const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)

describe('BudgetView', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows placeholders while the budgets load', async () => {
    vi.spyOn(api, 'fetchBudgets').mockReturnValue(new Promise(() => undefined))
    const mounted = await mountWithPlugins(BudgetView, {
      width: 1280,
      route: '/budget',
      session: makeSessionState(),
      beforeMount: () => seedFinance(),
    })

    expect(mounted.wrapper.find('[data-test="budget-loading"]').exists()).toBe(true)
  })

  it('shows the first budget, in the period the person is in, with how it is going', async () => {
    const { find, component, fetchPeriod, fetchHistory } = await render()

    expect(fetchPeriod).toHaveBeenCalledWith('budget-monthly', { on: undefined, today: day })
    expect(fetchHistory).toHaveBeenCalledWith('budget-monthly', { on: undefined, today: day })
    expect(find('period-title').text()).toBe('September 2026')
    expect(find('period-subtitle').text()).toBe('this month')
    expect(find('summary-left').text()).toBe('$750.00')
    expect(component('BudgetPaceChart').exists()).toBe(true)
    expect(component('BudgetHistoryChart').exists()).toBe(true)
    expect(find('budget-categories').text()).toContain('Where it went')
    expect(
      component('BudgetSwitcher')
        .findAll('[aria-pressed="true"]')
        .map((card) => card.attributes('data-test')),
    ).toEqual(['budget-card-budget-monthly'])
    expect(component('BudgetSources').exists()).toBe(true)
    expect(component('BudgetTransactions').props()).toMatchObject({
      budgetId: 'budget-monthly',
      on: '2026-09-01',
      removed: 0,
      readonly: false,
    })
  })

  it('shows the budget and the period the address names', async () => {
    const { fetchPeriod, find } = await render({
      route: '/budget?budget=budget-weekly&on=2026-08-02',
      period: (budget) =>
        periodOf(budget, { start: '2026-08-02', end: '2026-08-08', current: false }),
    })

    expect(fetchPeriod).toHaveBeenCalledTimes(1)
    expect(fetchPeriod).toHaveBeenCalledWith('budget-weekly', { on: '2026-08-02', today: day })
    expect(
      find('period-title')
        .text()
        .replace(/\u2009/g, ' '),
    ).toBe('Aug 2 – 8, 2026')
    expect(find('period-back').text()).toBe('Back to this week')
    expect(find('period-subtitle').exists()).toBe(false)
  })

  it('comes back to the budget looked at last when the address names none', async () => {
    localStorage.setItem('cashcove:budget', 'budget-weekly')

    const { fetchPeriod } = await render()

    expect(fetchPeriod).toHaveBeenCalledWith('budget-weekly', expect.anything())
  })

  it('shows the first budget when the one asked for, or remembered, is gone', async () => {
    localStorage.setItem('cashcove:budget', 'budget-deleted')

    const { fetchPeriod } = await render({ route: '/budget?budget=budget-gone' })

    expect(fetchPeriod).toHaveBeenCalledWith('budget-monthly', expect.anything())
  })

  it('carries on when the browser will not remember anything', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    const { find, routeIs, wrapper } = await render()

    await find('budget-card-budget-weekly').trigger('click')
    await routeIs({ budget: 'budget-weekly' })

    expect(wrapper.find('[data-test="budget-period"]').exists()).toBe(true)
  })

  it('switches between budgets, and remembers the one chosen', async () => {
    const { find, routeIs, fetchPeriod } = await render({ route: '/budget?on=2026-08-01' })

    await find('budget-card-budget-weekly').trigger('click')
    await routeIs({ budget: 'budget-weekly' })

    expect(localStorage.getItem('cashcove:budget')).toBe('budget-weekly')
    expect(fetchPeriod).toHaveBeenLastCalledWith('budget-weekly', { on: undefined, today: day })
    expect(find('budget-card-budget-weekly').attributes('aria-pressed')).toBe('true')
  })

  it('moves between periods, and back to the one the person is in', async () => {
    const { find, routeIs, fetchPeriod } = await render({
      period: (budget) => periodOf(budget, { previous: '2026-08-01', next: null }),
    })

    await find('period-previous').trigger('click')
    await routeIs({ on: '2026-08-01' })

    expect(fetchPeriod).toHaveBeenLastCalledWith('budget-monthly', {
      on: '2026-08-01',
      today: day,
    })
  })

  it('has no link to a period before the first one', async () => {
    const { find } = await render({ period: (budget) => periodOf(budget, { previous: null }) })

    expect(find('period-previous').attributes('disabled')).toBeDefined()
  })

  it('goes to the next period, and back to the current one', async () => {
    const { find, routeIs } = await render({
      route: '/budget?budget=budget-monthly&on=2026-07-01',
      period: (budget) =>
        periodOf(budget, {
          start: '2026-07-01',
          end: '2026-07-31',
          current: false,
          previous: '2026-06-01',
          next: '2026-08-01',
        }),
    })

    await find('period-next').trigger('click')
    await routeIs({ budget: 'budget-monthly', on: '2026-08-01' })

    await find('period-back').trigger('click')
    await routeIs({ budget: 'budget-monthly' })
  })

  it('looks at a period that was chosen on the history chart', async () => {
    const { component, routeIs } = await render()

    component('BudgetHistoryChart').vm.$emit('select', '2026-07-01')
    await routeIs({ on: '2026-07-01' })
  })

  it('says when the budgets or the period could not load, and tries again', async () => {
    const mounted = await render()
    mounted.fetchPeriod.mockRejectedValueOnce(new Error('Offline'))
    await mounted.find('budget-card-budget-weekly').trigger('click')
    await mounted.routeIs({ budget: 'budget-weekly' })

    expect(mounted.find('budget-error').text()).toContain("Couldn't load the budget. Offline")
    await mounted.find('budget-retry').trigger('click')
    await flushPromises()

    expect(mounted.find('budget-error').exists()).toBe(false)
    expect(mounted.find('budget-period').exists()).toBe(true)
  })

  it('says when the budgets themselves could not load', async () => {
    vi.spyOn(api, 'fetchBudgets').mockRejectedValue(new Error('Offline'))
    const mounted = await mountWithPlugins(BudgetView, {
      width: 1280,
      route: '/budget',
      session: makeSessionState(),
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    expect(mounted.wrapper.find('[data-test="budget-error"]').text()).toContain('Offline')
  })

  it('only shows the answer to the latest request', async () => {
    const answers: Record<string, (value: BudgetPeriodView) => void> = {}
    const mounted = await render()
    mounted.fetchPeriod.mockImplementation(
      (id) =>
        new Promise((resolve) => {
          answers[id] = resolve
        }),
    )

    await mounted.find('budget-card-budget-weekly').trigger('click')
    await mounted.routeIs({ budget: 'budget-weekly' })
    await mounted.find('budget-card-budget-monthly').trigger('click')
    await mounted.routeIs({ budget: 'budget-monthly' })
    answers['budget-monthly']!(periodOf(monthly, { spent: '10.00', left: '1990.00' }))
    await flushPromises()
    answers['budget-weekly']!(periodOf(weekly, { spent: '99.00', left: '51.00' }))
    await flushPromises()

    expect(mounted.find('summary-left').text()).toBe('$1,990.00')
  })

  it('ignores a failure of a request that a newer one replaced', async () => {
    const answers: { resolve: (value: BudgetPeriodView) => void; reject: (e: Error) => void }[] = []
    const mounted = await render()
    mounted.fetchPeriod.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answers.push({ resolve, reject })
        }),
    )

    await mounted.find('budget-card-budget-weekly').trigger('click')
    await mounted.routeIs({ budget: 'budget-weekly' })
    await mounted.find('budget-card-budget-monthly').trigger('click')
    await mounted.routeIs({ budget: 'budget-monthly' })
    answers[1]!.resolve(periodOf(monthly))
    await flushPromises()
    answers[0]!.reject(new Error('Too slow'))
    await flushPromises()

    expect(mounted.find('budget-error').exists()).toBe(false)
    expect(mounted.find('budget-period').exists()).toBe(true)
  })

  it('does nothing about a change of address before the budgets are known', async () => {
    let finish: (budgets: Budget[]) => void = () => undefined
    vi.spyOn(api, 'fetchBudgets').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const fetchPeriod = vi.spyOn(api, 'fetchBudgetPeriod').mockResolvedValue(periodOf(monthly))
    vi.spyOn(api, 'fetchBudgetHistory').mockResolvedValue({
      periods: makeHistory(),
      converted: [],
      unavailable: [],
    })
    vi.spyOn(api, 'fetchBudgetTransactions').mockResolvedValue({ items: [], total: 0 })
    const mounted = await mountWithPlugins(BudgetView, {
      width: 1280,
      route: '/budget',
      session: makeSessionState(),
      beforeMount: () => seedFinance(),
    })

    await mounted.router.replace({ query: { on: '2026-08-01' } })
    await flushPromises()
    expect(fetchPeriod).not.toHaveBeenCalled()
    finish([monthly])
    await flushPromises()

    expect(fetchPeriod).toHaveBeenCalledTimes(1)
  })

  it('says which currencies were converted, and which could not be', async () => {
    const { find } = await render({
      period: (budget) => periodOf(budget, { converted: ['EUR'], unavailable: ['GBP', 'JPY'] }),
    })

    expect(find('budget-converted').text()).toBe(
      "Amounts in EUR are converted to USD at each day's exchange rate.",
    )
    expect(find('budget-unavailable').text()).toBe(
      "There's no exchange rate for GBP, JPY, so those transactions aren't counted.",
    )
  })

  it('does not mention currencies when there is nothing to say', async () => {
    const { find } = await render()

    expect(find('budget-converted').exists()).toBe(false)
    expect(find('budget-unavailable').exists()).toBe(false)
  })

  it('shows the bills still to come, and says when nothing was spent', async () => {
    const { find, component } = await render({
      period: (budget) =>
        periodOf(budget, {
          upcoming: [{ subscription_id: 's', name: 'Gym', due_on: '2026-09-25', amount: '30.00' }],
          categories: [],
        }),
    })

    expect(component('UpcomingBills').exists()).toBe(true)
    expect(find('categories-empty').text()).toBe('Nothing has been spent in this period.')
    expect(component('CategoryBars').exists()).toBe(false)
  })

  it('has no bills or empty note when there is something to show', async () => {
    const { component, find } = await render()

    expect(component('UpcomingBills').exists()).toBe(false)
    expect(component('CategoryBars').exists()).toBe(true)
    expect(find('categories-empty').exists()).toBe(false)
  })

  describe('choosing what counts', () => {
    const nothing = (budget: Budget) =>
      periodOf(budget, { sources: [], transactions: 0, categories: [], daily: [] })

    it('starts a budget that counts nothing yet with what to add', async () => {
      const { find, component } = await render({ period: nothing })

      expect(find('budget-unset').text()).toContain('Start by choosing what counts')
      await find('unset-income').trigger('click')
      await flushPromises()
      expect(component('BudgetLinkDialog').props()).toMatchObject({
        modelValue: true,
        kind: 'income',
      })

      component('BudgetLinkDialog').vm.$emit('update:modelValue', false)
      await find('unset-spending').trigger('click')
      await flushPromises()
      expect(component('BudgetLinkDialog').props('kind')).toBe('spending')
    })

    it('adds income or spending from the lists of what counts', async () => {
      const { component } = await render()

      component('BudgetSources').vm.$emit('add', 'income')
      await flushPromises()

      expect(component('BudgetLinkDialog').props()).toMatchObject({
        modelValue: true,
        kind: 'income',
      })
      expect(component('BudgetLinkDialog').props('budget')).toMatchObject({ id: 'budget-monthly' })
    })

    it('looks again at everything once something was added', async () => {
      const { component, fetchBudgets, fetchPeriod, fetchTransactions } = await render()

      component('BudgetLinkDialog').vm.$emit('added')
      await flushPromises()

      expect(fetchBudgets).toHaveBeenCalledTimes(2)
      expect(fetchPeriod).toHaveBeenCalledTimes(2)
      expect(fetchTransactions).toHaveBeenCalledTimes(2)
    })

    it('stops counting a source', async () => {
      const remove = vi.spyOn(api, 'removeBudgetSource').mockResolvedValue(undefined)
      const { component, fetchPeriod } = await render()
      const source = makeSource()

      component('BudgetSources').vm.$emit('remove', source)
      await flushPromises()

      expect(remove).toHaveBeenCalledWith('budget-monthly', source.id)
      expect(notices.value.at(-1)?.text).toBe('Stopped counting Groceries in Household')
      expect(fetchPeriod).toHaveBeenCalledTimes(2)
    })

    it('says what went wrong when a source could not be removed', async () => {
      vi.spyOn(api, 'removeBudgetSource').mockRejectedValue(
        new ApiError(404, 'That doesn’t count toward this budget.'),
      )
      const { component, find } = await render()

      component('BudgetSources').vm.$emit('remove', makeSource())
      await flushPromises()

      expect(find('budget-error').text()).toContain('That doesn’t count toward this budget.')
    })

    it('has nothing to say to viewers about what to add', async () => {
      const { find, component } = await render({ role: 'viewer', period: nothing })

      expect(find('budget-unset').text()).toContain('An admin hasn’t chosen what counts')
      expect(find('unset-income').exists()).toBe(false)
      expect(component('BudgetLinkDialog').exists()).toBe(false)
    })
  })

  describe('making and changing budgets', () => {
    it('makes the first budget', async () => {
      const { find, component } = await render({ budgets: [] })

      expect(find('budget-empty').text()).toContain('Plan with a budget')
      await find('budget-first').trigger('click')
      await flushPromises()

      expect(component('BudgetDialog').props()).toMatchObject({ modelValue: true, budget: null })
    })

    it('makes another from the header or from the switcher', async () => {
      const { find, component } = await render()

      await find('budget-new').trigger('click')
      await flushPromises()
      expect(component('BudgetDialog').props('modelValue')).toBe(true)
      component('BudgetDialog').vm.$emit('update:modelValue', false)
      await flushPromises()
      await find('budget-add').trigger('click')
      await flushPromises()

      expect(component('BudgetDialog').props()).toMatchObject({ modelValue: true, budget: null })
    })

    it('looks at a new budget once it is made', async () => {
      const { component, routeIs, fetchPeriod, fetchBudgets } = await render()
      const made = makeBudget({ id: 'budget-new', name: 'Year', period: 'yearly' })
      fetchBudgets.mockResolvedValue([monthly, weekly, made])
      fetchPeriod.mockResolvedValue(periodOf(made))

      component('BudgetDialog').vm.$emit('saved', made)
      await routeIs({ budget: 'budget-new' })

      expect(localStorage.getItem('cashcove:budget')).toBe('budget-new')
      expect(fetchPeriod).toHaveBeenLastCalledWith('budget-new', expect.anything())
    })

    it('changes the budget being looked at, and shows what changed', async () => {
      const { find, component, fetchPeriod, fetchBudgets } = await render()

      await find('budget-actions').trigger('click')
      await flushPromises()
      component('BudgetSummary').vm.$emit('edit')
      await flushPromises()
      expect(component('BudgetDialog').props()).toMatchObject({
        modelValue: true,
        budget: { id: 'budget-monthly' },
      })

      const renamed = { ...monthly, name: 'Home' }
      fetchBudgets.mockResolvedValue([renamed, weekly])
      fetchPeriod.mockResolvedValue(periodOf(renamed))
      component('BudgetDialog').vm.$emit('saved', renamed)
      await flushPromises()

      expect(component('BudgetSwitcher').text()).toContain('Home')
      expect(find('budget-card-budget-monthly').text()).toContain('Home')
    })

    it('deletes the budget once confirmed, and looks at another', async () => {
      const remove = vi.spyOn(api, 'deleteBudget').mockResolvedValue(undefined)
      const { component, find, fetchBudgets, routeIs } = await render({
        route: '/budget?budget=budget-monthly',
      })

      component('BudgetSummary').vm.$emit('delete')
      await flushPromises()
      expect(confirmRequest.value).toMatchObject({
        title: 'Delete Household?',
        confirmText: 'Delete budget',
        tone: 'error',
      })
      await answer(false)
      expect(remove).not.toHaveBeenCalled()

      fetchBudgets.mockResolvedValue([weekly])
      component('BudgetSummary').vm.$emit('delete')
      await flushPromises()
      await answer(true)
      await flushPromises()

      expect(remove).toHaveBeenCalledWith('budget-monthly')
      expect(notices.value.at(-1)?.text).toBe('Deleted Household')
      await routeIs({})
      expect(find('budget-card-budget-weekly').attributes('aria-pressed')).toBe('true')
    })

    it('goes back to the first budget page once the last budget is deleted', async () => {
      vi.spyOn(api, 'deleteBudget').mockResolvedValue(undefined)
      const { component, find, fetchBudgets } = await render({ budgets: [monthly] })

      fetchBudgets.mockResolvedValue([])
      component('BudgetSummary').vm.$emit('delete')
      await flushPromises()
      await answer(true)
      await flushPromises()

      expect(find('budget-empty').exists()).toBe(true)
    })
  })

  describe('for a viewer', () => {
    it('shows the budgets without ways to change them', async () => {
      const { find, component } = await render({ role: 'viewer' })

      expect(find('read-only-notice').text()).toContain('Only an admin can change them')
      expect(find('budget-new').exists()).toBe(false)
      expect(find('budget-add').exists()).toBe(false)
      expect(find('budget-actions').exists()).toBe(false)
      expect(component('BudgetDialog').exists()).toBe(false)
      expect(component('BudgetSources').props('readonly')).toBe(true)
    })

    it('tells them when there is no budget yet', async () => {
      const { find } = await render({ role: 'viewer', budgets: [] })

      expect(find('budget-empty').text()).toContain('An admin hasn’t made a budget yet.')
      expect(find('budget-first').exists()).toBe(false)
    })
  })

  it('shows placeholders, not the last budget’s numbers, while another budget loads', async () => {
    const mounted = await render()
    mounted.fetchPeriod.mockReturnValue(new Promise(() => undefined))

    await mounted.find('budget-card-budget-weekly').trigger('click')
    await mounted.routeIs({ budget: 'budget-weekly' })

    expect(mounted.find('budget-period-loading').exists()).toBe(true)
    expect(mounted.find('budget-period').exists()).toBe(false)
  })

  it('keeps showing the period it has while another period of the budget loads', async () => {
    const mounted = await render()
    mounted.fetchPeriod.mockReturnValue(new Promise(() => undefined))
    mounted.fetchHistory.mockReturnValue(new Promise<BudgetHistory>(() => undefined))

    await mounted.find('period-previous').trigger('click')
    await mounted.routeIs({ on: '2026-08-01' })

    expect(mounted.find('budget-period').classes()).toContain('budget-view--loading')
  })
})
