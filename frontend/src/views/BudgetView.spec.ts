import * as budgetApi from '@/api/budget'
import * as subscriptionsApi from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import type { BudgetConfiguration, BudgetLine, BudgetMonth, BudgetYear } from '@/api/budget'
import type { Subscription } from '@/api/subscriptions'
import type { Transaction } from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import {
  checking,
  coffee,
  groceries,
  makeAccount,
  makeCategory,
  makeGroups,
  makePage,
  makeTransaction,
  paycheck,
  savings,
  seedFinance,
} from '@/test/finance'
import { makePreferences, makeSessionState, makeUser } from '@/test/fixtures'
import { page } from '@/test/dom'
import { flushPromises, mountWithPlugins } from '@/test/mount'
import { makeSubscription } from '@/test/subscriptions'
import BudgetView from '@/views/BudgetView.vue'

const currentMonth = () => new Date().toISOString().slice(0, 7)
const travel = makeCategory({
  id: 'category-travel',
  name: 'Travel',
  emoji: '✈️',
})
const canadianAccount = makeAccount({
  id: 'account-canadian',
  name: 'Canadian chequing',
  currency: 'CAD',
})
const accountWithoutInstitution = makeAccount({
  id: 'account-no-institution',
  name: 'Cash envelope',
  institution: null,
})

function line(
  category: typeof groceries,
  changes: Partial<BudgetMonth['groups'][number]['categories'][number]> = {},
) {
  return {
    category_id: category.id,
    name: category.name,
    emoji: category.emoji,
    period: 'monthly' as const,
    amount: null,
    budgeted: '0.00',
    rollover: false,
    carried: '0.00',
    actual: '0.00',
    year_to_date: null,
    average: '0.00',
    count: 0,
    ...changes,
  }
}

function makeMonth(month = currentMonth()): BudgetMonth {
  const year = Number(month.slice(0, 4))
  return {
    month,
    currency: 'USD',
    year,
    year_start: `${year}-01`,
    year_end: `${year}-12`,
    income: { budgeted: '4200.00', carried: '0.00', actual: '2600.00' },
    spending: { budgeted: '600.00', carried: '25.00', actual: '575.00' },
    groups: [
      {
        id: 'group-income',
        name: 'Income',
        kind: 'income',
        categories: [
          line(paycheck, {
            period: 'monthly',
            amount: '4200.00',
            budgeted: '4200.00',
            actual: '2600.00',
            count: 2,
          }),
        ],
      },
      {
        id: 'group-food',
        name: 'Food & drink',
        kind: 'expense',
        categories: [
          line(groceries, {
            period: 'monthly',
            amount: '500.00',
            budgeted: '500.00',
            actual: '470.00',
            count: 7,
          }),
          line(coffee, { period: null, count: 1, actual: '12.00' }),
          line(travel, {
            period: 'yearly',
            amount: '1000.00',
            budgeted: '83.33',
            actual: '90.00',
            year_to_date: '950.00',
            count: 1,
          }),
        ],
      },
    ],
    uncategorized: { received: '0.00', spent: '93.00', count: 2 },
    other_currencies: [],
  }
}

function makeYear(year: number, selected = currentMonth()): BudgetYear {
  return {
    year,
    start: `${year}-01`,
    end: `${year}-12`,
    currency: 'USD',
    income: { budgeted: '50400.00', actual: '31200.00' },
    spending: { budgeted: '7200.00', actual: '6900.00' },
    months: Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`
      return {
        month,
        income: { budgeted: '4200.00', actual: month === selected ? '2600.00' : '0.00' },
        spending: {
          budgeted: '600.00',
          actual: month === selected ? '470.00' : '0.00',
        },
      }
    }),
  }
}

const paycheckTransaction: Transaction = makeTransaction({
  id: 'transaction-paycheck',
  date: `${currentMonth()}-15`,
  amount: '2400.00',
  payee: 'Acme Corp',
  category_id: null,
})

const billTransaction: Transaction = makeTransaction({
  id: 'transaction-power',
  date: `${currentMonth()}-09`,
  amount: '-96.40',
  payee: 'City Power & Light',
  category_id: null,
})
const orphanIncomeTransaction: Transaction = makeTransaction({
  id: 'transaction-orphan',
  account_id: 'account-no-longer-available',
  date: `${currentMonth()}-18`,
  amount: '100.00',
  payee: 'Old employer',
  category_id: null,
})
const powerSubscription: Subscription = makeSubscription({
  id: 'subscription-power',
  name: 'City Power',
  payee: 'City Power & Light',
  amount: '96.40',
  account_id: checking.id,
  category_id: null,
})
const savingsSubscription: Subscription = makeSubscription({
  id: 'subscription-savings',
  name: 'Storage bill',
  account_id: savings.id,
})
const orphanSubscription: Subscription = makeSubscription({
  id: 'subscription-orphan',
  name: 'Old storage',
  account_id: 'account-no-longer-available',
})
const canadianSubscription: Subscription = makeSubscription({
  id: 'subscription-canadian',
  name: 'Canadian storage',
  account_id: canadianAccount.id,
})

function makeConfigurations(
  linked: string[] = [],
  linkedSubscriptions: string[] = [],
  linkedElsewhere = false,
  multipleLinks = false,
  allAccounts = false,
): BudgetConfiguration[] {
  return [
    {
      id: 'budget-paycheck',
      category_id: paycheck.id,
      period: 'monthly',
      amount: '4200.00',
      rollover: false,
      cycle_anchor: null,
      account_ids: [],
      linked_transaction_ids: linked.includes(paycheckTransaction.id)
        ? [paycheckTransaction.id, ...(multipleLinks ? [orphanIncomeTransaction.id] : [])]
        : [],
      linked_subscription_ids: [],
    },
    {
      id: 'budget-groceries',
      category_id: groceries.id,
      period: 'monthly',
      amount: '500.00',
      rollover: false,
      cycle_anchor: null,
      account_ids: allAccounts ? [] : [checking.id],
      linked_transaction_ids: linked.includes(billTransaction.id)
        ? [billTransaction.id, ...(multipleLinks ? [orphanIncomeTransaction.id] : [])]
        : [],
      linked_subscription_ids: linkedSubscriptions.includes(powerSubscription.id)
        ? [powerSubscription.id, ...(multipleLinks ? [savingsSubscription.id] : [])]
        : [],
    },
    {
      id: 'budget-travel',
      category_id: travel.id,
      period: 'yearly',
      amount: '1000.00',
      rollover: false,
      cycle_anchor: null,
      account_ids: ['missing-account'],
      linked_transaction_ids: linkedElsewhere ? [billTransaction.id] : [],
      linked_subscription_ids: linkedElsewhere ? [savingsSubscription.id] : [],
    },
  ]
}

interface DeferredMonth {
  month: string
  resolve: (month: BudgetMonth) => void
  reject: (reason?: unknown) => void
}

interface RenderOptions {
  role?: 'admin' | 'viewer'
  empty?: boolean
  fail?: boolean
  linked?: boolean
  alertEnabled?: boolean
  allUnbudgeted?: boolean
  otherCurrencies?: boolean
  withoutPreferences?: boolean
  withoutYear?: boolean
  linkedElsewhere?: boolean
  multipleLinks?: boolean
  allAccounts?: boolean
  rollover?: boolean
  noRollover?: boolean
  threshold?: number
  emptySubscriptions?: boolean
  failSubscriptions?: boolean
  failTransactions?: boolean
  emptyTransactions?: boolean
  deferredMonths?: { requests: DeferredMonth[] }
  missingCurrency?: boolean
  missingThreshold?: boolean
}

async function render({
  role = 'admin',
  empty = false,
  fail = false,
  linked = false,
  alertEnabled = true,
  allUnbudgeted = false,
  otherCurrencies = false,
  withoutPreferences = false,
  withoutYear = false,
  linkedElsewhere = false,
  multipleLinks = false,
  allAccounts = false,
  rollover = false,
  noRollover = false,
  threshold = 90,
  emptySubscriptions = false,
  failSubscriptions = false,
  failTransactions = false,
  emptyTransactions = false,
  deferredMonths,
  missingCurrency = false,
  missingThreshold = false,
}: RenderOptions = {}) {
  const buildMonth = (month: string) => {
    const data = makeMonth(month)
    if (allUnbudgeted) {
      data.groups = data.groups.map((group) => ({
        ...group,
        categories: group.categories.map((item) => ({
          ...item,
          period: null,
          amount: null,
          budgeted: '0.00',
        })),
      }))
    }
    if (rollover) {
      data.groups = data.groups.map((group) => ({
        ...group,
        categories: group.categories.map((item) =>
          item.category_id === groceries.id ? { ...item, rollover: true } : item,
        ),
      }))
    }
    if (otherCurrencies) data.other_currencies = ['CAD']
    if (noRollover) data.spending.carried = '0.00'
    if (missingCurrency) data.currency = undefined as unknown as string
    return data
  }
  const monthFetch = vi.spyOn(budgetApi, 'fetchBudgetMonth')
  if (deferredMonths) {
    monthFetch.mockImplementation(
      (month) =>
        new Promise((resolve, reject) => {
          deferredMonths.requests.push({ month, resolve, reject })
        }),
    )
  } else if (fail) {
    monthFetch
      .mockRejectedValueOnce(new Error('Temporary problem'))
      .mockImplementation((month) => Promise.resolve(buildMonth(month)))
  } else if (empty) {
    monthFetch.mockImplementation((month) => Promise.resolve({ ...makeMonth(month), groups: [] }))
  } else {
    monthFetch.mockImplementation((month) => Promise.resolve(buildMonth(month)))
  }
  const yearFetch = vi
    .spyOn(budgetApi, 'fetchBudgetYear')
    .mockImplementation((year) =>
      Promise.resolve(withoutYear ? (null as unknown as BudgetYear) : makeYear(year)),
    )
  const linkedTransactions = new Set(linked ? [paycheckTransaction.id] : [])
  const linkedSubscriptions = new Set<string>()
  if (multipleLinks) {
    linkedTransactions.add(billTransaction.id)
    linkedTransactions.add(orphanIncomeTransaction.id)
    linkedSubscriptions.add(powerSubscription.id)
    linkedSubscriptions.add(savingsSubscription.id)
  }
  const configurationsFetch = vi
    .spyOn(budgetApi, 'fetchBudgetConfigurations')
    .mockImplementation(() =>
      Promise.resolve(
        makeConfigurations(
          [...linkedTransactions],
          [...linkedSubscriptions],
          linkedElsewhere,
          multipleLinks,
          allAccounts,
        ),
      ),
    )
  const subscriptionFetch = vi.spyOn(subscriptionsApi, 'fetchSubscriptions')
  if (failSubscriptions) {
    subscriptionFetch
      .mockRejectedValueOnce(new Error('Subscriptions unavailable'))
      .mockResolvedValue([
        powerSubscription,
        savingsSubscription,
        canadianSubscription,
        orphanSubscription,
      ])
  } else {
    subscriptionFetch.mockResolvedValue(
      emptySubscriptions
        ? []
        : [powerSubscription, savingsSubscription, canadianSubscription, orphanSubscription],
    )
  }
  const transactionFetch = vi.spyOn(transactionsApi, 'fetchTransactions')
  if (failTransactions) {
    transactionFetch
      .mockRejectedValueOnce(new Error('Transactions unavailable'))
      .mockImplementation((query) =>
        Promise.resolve(
          makePage(
            query?.direction === 'out'
              ? [billTransaction]
              : [paycheckTransaction, orphanIncomeTransaction],
          ),
        ),
      )
  } else {
    transactionFetch.mockImplementation((query) =>
      Promise.resolve(
        emptyTransactions
          ? makePage([])
          : makePage(
              query?.direction === 'out'
                ? [billTransaction]
                : [paycheckTransaction, orphanIncomeTransaction],
            ),
      ),
    )
  }
  const mounted = await mountWithPlugins(BudgetView, {
    route: '/budget',
    width: 1280,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      const seeded = seedFinance({
        accounts: [checking, savings, canadianAccount, accountWithoutInstitution],
        groups: makeGroups(),
      })
      if (withoutPreferences) {
        seeded.preferences.saved = null
        seeded.preferences.load = vi.fn()
      } else {
        seeded.preferences.saved = makePreferences()
        seeded.preferences.saved.alerts.budget_threshold_enabled = alertEnabled
        seeded.preferences.saved.alerts.budget_threshold_percent = threshold
        if (missingThreshold) {
          seeded.preferences.saved.alerts.budget_threshold_percent = undefined as unknown as number
        }
      }
    },
  })
  await flushPromises()
  await flushPromises()
  const { wrapper } = mounted
  const find = (name: string) => {
    const local = wrapper.find(`[data-test="${name}"]`)
    return local.exists() ? local : page().find(`[data-test="${name}"]`)
  }
  const link = vi
    .spyOn(budgetApi, 'linkBudgetTransaction')
    .mockImplementation((_categoryId, transactionId) => {
      linkedTransactions.add(transactionId)
      return Promise.resolve(undefined)
    })
  const unlink = vi
    .spyOn(budgetApi, 'unlinkBudgetTransaction')
    .mockImplementation((_categoryId, transactionId) => {
      linkedTransactions.delete(transactionId)
      return Promise.resolve(undefined)
    })
  const linkSubscription = vi
    .spyOn(budgetApi, 'linkBudgetSubscription')
    .mockImplementation((_categoryId, subscriptionId) => {
      linkedSubscriptions.add(subscriptionId)
      return Promise.resolve(undefined)
    })
  const unlinkSubscription = vi
    .spyOn(budgetApi, 'unlinkBudgetSubscription')
    .mockImplementation((_categoryId, subscriptionId) => {
      linkedSubscriptions.delete(subscriptionId)
      return Promise.resolve(undefined)
    })
  return {
    ...mounted,
    find,
    monthFetch,
    yearFetch,
    configurationsFetch,
    transactionFetch,
    subscriptionFetch,
    link,
    unlink,
    linkSubscription,
    unlinkSubscription,
  }
}

describe('BudgetView', () => {
  it('shows budget progress in dollars and percent, alerts and the yearly chart', async () => {
    const { wrapper, find } = await render()

    expect(find(`budget-category-${groceries.id}`).text()).toContain('94%')
    expect(find(`budget-category-${groceries.id}`).text()).toContain('$470.00 spent')
    expect(find(`budget-category-${groceries.id}`).text()).toContain('$500.00')
    expect(find(`budget-category-${travel.id}`).text()).toContain('95%')
    expect(find(`budget-category-${travel.id}`).text()).toContain('$950.00')
    expect(
      find(`budget-category-${travel.id}`)
        .find('[data-test="budget-progress-bar"]')
        .attributes('aria-label'),
    ).toContain('yearly target')
    expect(find(`budget-category-${travel.id}`).text()).toContain('Account unavailable')
    expect(find('budget-alert').text()).toContain('near or over')
    expect(find('budget-year-chart').exists()).toBe(true)
    expect(find('budget-rollover-total').text()).toContain('$25.00')
    wrapper.unmount()
  })

  it('shows loading state and an empty add menu while the month is pending', async () => {
    const deferredMonths: { requests: DeferredMonth[] } = { requests: [] }
    const { wrapper, find } = await render({ deferredMonths })
    expect(find('budget-loading').exists()).toBe(true)
    await find('budget-add').trigger('click')
    await flushPromises()
    expect(find(`budget-menu-${groceries.id}`).exists()).toBe(false)
    const request = deferredMonths.requests[0]
    if (!request) throw new Error('The initial month request should be pending')
    request.resolve(makeMonth(request.month))
    await flushPromises()
    await flushPromises()
    expect(find('budget-year-chart').exists()).toBe(true)
    wrapper.unmount()
  })

  it('uses the configured alert default and budget currency fallback', async () => {
    const alerts = await render({ missingThreshold: true })
    expect(alerts.find('budget-alert').exists()).toBe(true)
    alerts.wrapper.unmount()

    const currency = await render({ missingCurrency: true })
    expect(currency.wrapper.find('.budget-summary').text()).toContain('$')
    currency.wrapper.unmount()
  })

  it('moves between months and can return to the current month', async () => {
    const { wrapper, find, monthFetch, yearFetch } = await render()
    const current = currentMonth()

    await find('budget-previous').trigger('click')
    await flushPromises()
    const [year, month] = current.split('-').map(Number)
    const previous = new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 7)
    expect(monthFetch).toHaveBeenLastCalledWith(previous)
    expect(yearFetch).toHaveBeenCalled()

    await find('budget-current-month').trigger('click')
    await flushPromises()
    expect(monthFetch).toHaveBeenLastCalledWith(current)
    wrapper.unmount()
  })

  it('loads a month entered directly in the date field', async () => {
    const { wrapper, find, monthFetch } = await render()
    await find('budget-month').find('input').setValue('2026-01')
    await flushPromises()
    expect(monthFetch).toHaveBeenLastCalledWith('2026-01')
    wrapper.unmount()
  })

  it('sets a recurring target with an account scope from the category card', async () => {
    const { wrapper, find } = await render()
    const save = vi.spyOn(budgetApi, 'saveCategoryBudget').mockResolvedValue(makeMonth())

    await find(`budget-edit-${groceries.id}`).trigger('click')
    await flushPromises()
    await page().find('.money-field input').setValue('700')
    const periodControl = wrapper.findComponent({ name: 'VSelect' })
    if (!periodControl.exists()) throw new Error('The budget frequency control was not mounted')
    periodControl.vm.$emit('update:modelValue', 'weekly')
    await flushPromises()
    const accountControl = wrapper.findComponent({ name: 'VAutocomplete' })
    if (!accountControl.exists()) throw new Error('The account selector was not mounted')
    accountControl.vm.$emit('update:modelValue', [checking.id])
    await flushPromises()
    await find('budget-cycle-anchor').find('input').setValue(`${currentMonth()}-03`)
    await flushPromises()
    await find('budget-save').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(groceries.id, {
      month: currentMonth(),
      period: 'weekly',
      amount: '700.00',
      scope: 'onward',
      rollover: false,
      cycle_anchor: `${currentMonth()}-03`,
      account_ids: [checking.id],
    })
    expect(find('budget-editor').exists()).toBe(true)
    await find('budget-cancel').trigger('click')
    wrapper.unmount()
  })

  it('keeps rollover and month-only changes on a monthly budget', async () => {
    const { wrapper, find } = await render()
    const save = vi.spyOn(budgetApi, 'saveCategoryBudget').mockResolvedValue(makeMonth())

    await find(`budget-edit-${groceries.id}`).trigger('click')
    await flushPromises()
    const scope = wrapper
      .findAllComponents({ name: 'VSelect' })
      .find((control) => control.attributes('data-test') === 'budget-scope')
    if (!scope) throw new Error('The budget scope control was not mounted')
    scope.vm.$emit('update:modelValue', 'only')
    wrapper.findComponent({ name: 'VSwitch' }).vm.$emit('update:modelValue', true)
    await find('budget-save').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(
      groceries.id,
      expect.objectContaining({ scope: 'only', period: 'monthly', rollover: true }),
    )
    wrapper.unmount()
  })

  it('shows singular alert text and rollover with multiple linked bills', async () => {
    const { wrapper, find } = await render({
      linked: true,
      multipleLinks: true,
      rollover: true,
      noRollover: true,
      threshold: 95,
    })

    expect(find('budget-alert').text()).toContain('1 category is near')
    expect(find('budget-rollover-total').exists()).toBe(false)
    const groceriesCard = find(`budget-category-${groceries.id}`)
    expect(groceriesCard.text()).toContain('rollover on')
    expect(groceriesCard.find('[data-test="budget-linked-count"]').text()).toContain(
      '2 bill or spending transactions',
    )
    expect(groceriesCard.find('[data-test="budget-subscription-count"]').text()).toContain(
      '2 recurring bills',
    )
    wrapper.unmount()
  })

  it('validates amounts, stops an unbudgeted category, and reports save failures', async () => {
    const { wrapper, find } = await render()
    const save = vi
      .spyOn(budgetApi, 'saveCategoryBudget')
      .mockRejectedValueOnce(new Error('No connection'))
      .mockResolvedValue(makeMonth())

    await find(`budget-edit-${groceries.id}`).trigger('click')
    await flushPromises()
    await page().find('.money-field input').setValue('not money')
    await find('budget-save').trigger('click')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()

    await page().find('.money-field input').setValue('700')
    await find('budget-save').trigger('click')
    await flushPromises()
    expect(notices.value.at(-1)).toMatchObject({
      text: "Couldn't save the budget. No connection",
      tone: 'error',
    })

    save.mockResolvedValue(makeMonth())
    await find('dialog-close').trigger('click')
    await find(`budget-edit-${coffee.id}`).trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'weekly')
    await flushPromises()
    await page().find('[data-test="budget-cycle-anchor"] input').setValue('')
    await find('budget-save').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(
      coffee.id,
      expect.objectContaining({
        amount: null,
        period: 'weekly',
        cycle_anchor: `${currentMonth()}-01`,
      }),
    )
    expect(notices.value.at(-1)?.text).toContain('Stopped this budget')
    wrapper.unmount()
  })

  it('deletes a budget only after confirmation', async () => {
    const { wrapper, find } = await render()
    const remove = vi.spyOn(budgetApi, 'deleteCategoryBudget').mockResolvedValue(undefined)

    await find(`budget-edit-${groceries.id}`).trigger('click')
    await flushPromises()
    await find('budget-delete').trigger('click')
    await flushPromises()
    expect(confirmRequest.value?.confirmText).toBe('Delete budget')
    await answer(false)
    expect(remove).not.toHaveBeenCalled()

    await find('budget-delete').trigger('click')
    await flushPromises()
    await answer(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(groceries.id)
    wrapper.unmount()
  })

  it('links paycheck and bill transactions without changing their category', async () => {
    const { wrapper, find, transactionFetch, link, unlink } = await render()

    await find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    expect(transactionFetch).toHaveBeenCalledWith({
      start: `${currentMonth()}-01`,
      end: new Date(
        Date.UTC(Number(currentMonth().slice(0, 4)), Number(currentMonth().slice(5)), 0),
      )
        .toISOString()
        .slice(0, 10),
      direction: 'in',
      page_size: 100,
      sort: '-date',
    })
    await find(`budget-link-${paycheckTransaction.id}`).trigger('click')
    await flushPromises()
    expect(link).toHaveBeenCalledWith(paycheck.id, paycheckTransaction.id)
    expect(find(`budget-unlink-${paycheckTransaction.id}`).exists()).toBe(true)
    await find(`budget-unlink-${paycheckTransaction.id}`).trigger('click')
    await flushPromises()
    expect(unlink).toHaveBeenCalledWith(paycheck.id, paycheckTransaction.id)

    await find(`budget-link-expense-${groceries.id}`).trigger('click')
    await flushPromises()
    expect(transactionFetch).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'out' }))
    await find(`budget-link-${billTransaction.id}`).trigger('click')
    await flushPromises()
    expect(link).toHaveBeenCalledWith(groceries.id, billTransaction.id)
    await find(`budget-unlink-${billTransaction.id}`).trigger('click')
    await flushPromises()
    expect(unlink).toHaveBeenCalledWith(groceries.id, billTransaction.id)
    await find('budget-transactions-done').trigger('click')
    await find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    await find('dialog-close').trigger('click')
    wrapper.unmount()
  })

  it('ignores stale month and transaction list responses', async () => {
    const { wrapper, find, monthFetch } = await render()
    const pendingMonths: DeferredMonth[] = []
    monthFetch.mockImplementation(
      (month) => new Promise((resolve, reject) => pendingMonths.push({ month, resolve, reject })),
    )
    await find('budget-next').trigger('click')
    await flushPromises()
    await find('budget-next').trigger('click')
    await flushPromises()
    await find('budget-next').trigger('click')
    await flushPromises()
    expect(pendingMonths).toHaveLength(3)
    const newest = pendingMonths[2]
    const staleSuccess = pendingMonths[0]
    const staleError = pendingMonths[1]
    if (!newest || !staleSuccess || !staleError) {
      throw new Error('All month requests should be pending')
    }
    newest.resolve(makeMonth(newest.month))
    await flushPromises()
    staleSuccess.resolve(makeMonth(staleSuccess.month))
    await flushPromises()
    staleError.reject(new Error('An obsolete month failed'))
    await flushPromises()
    expect(find('budget-error').exists()).toBe(false)
    wrapper.unmount()

    const requests: {
      resolve: (result: ReturnType<typeof makePage>) => void
      reject: (reason?: unknown) => void
    }[] = []
    const transactionLists = await render()
    transactionLists.transactionFetch.mockImplementation(
      () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    )
    await transactionLists.find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    await transactionLists.find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    await transactionLists.find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    const latest = requests[2]
    const staleTransactionSuccess = requests[0]
    const staleTransactionError = requests[1]
    if (!latest || !staleTransactionSuccess || !staleTransactionError) {
      throw new Error('All transaction requests should be pending')
    }
    latest.resolve(makePage([paycheckTransaction]))
    await flushPromises()
    staleTransactionSuccess.resolve(makePage([orphanIncomeTransaction]))
    await flushPromises()
    staleTransactionError.reject(new Error('An obsolete transaction request failed'))
    await flushPromises()
    expect(transactionLists.find('budget-transactions-error').exists()).toBe(false)
    transactionLists.wrapper.unmount()
  })

  it('links recurring subscriptions to spending budgets and unlinks them', async () => {
    const { wrapper, find, subscriptionFetch, linkSubscription, unlinkSubscription } =
      await render()

    await find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    expect(subscriptionFetch).toHaveBeenCalledOnce()
    expect(find(`budget-subscription-${powerSubscription.id}`).exists()).toBe(true)
    await find(`budget-link-subscription-${powerSubscription.id}`).trigger('click')
    await flushPromises()
    expect(linkSubscription).toHaveBeenCalledWith(groceries.id, powerSubscription.id)
    expect(find(`budget-unlink-subscription-${powerSubscription.id}`).exists()).toBe(true)
    await find(`budget-unlink-subscription-${powerSubscription.id}`).trigger('click')
    await flushPromises()
    expect(unlinkSubscription).toHaveBeenCalledWith(groceries.id, powerSubscription.id)
    await find('budget-subscriptions-done').trigger('click')
    await find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    await find('dialog-close').trigger('click')
    wrapper.unmount()
  })

  it('ignores stale recurring-bill lists', async () => {
    const requests: {
      resolve: (items: Subscription[]) => void
      reject: (reason?: unknown) => void
    }[] = []
    const { wrapper, find, subscriptionFetch } = await render()
    subscriptionFetch.mockImplementation(
      () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    )
    await find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    await find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    await find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    const latest = requests[2]
    const staleSuccess = requests[0]
    const staleError = requests[1]
    if (!latest || !staleSuccess || !staleError) {
      throw new Error('All subscription requests should be pending')
    }
    latest.resolve([powerSubscription])
    await flushPromises()
    staleSuccess.resolve([])
    await flushPromises()
    staleError.reject(new Error('An obsolete subscription request failed'))
    await flushPromises()
    expect(find(`budget-subscription-${powerSubscription.id}`).exists()).toBe(true)
    expect(find('budget-subscriptions-error').exists()).toBe(false)
    await find('dialog-close').trigger('click')
    wrapper.unmount()
  })

  it('shows read-only access for viewers and respects disabled budget alerts', async () => {
    const { wrapper, find } = await render({ role: 'viewer', alertEnabled: false })

    expect(find('read-only-notice').text()).toContain('Only an admin can change it')
    expect(find('budget-add').exists()).toBe(false)
    expect(find(`budget-edit-${groceries.id}`).exists()).toBe(false)
    expect(find('budget-alert').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows unbudgeted, currency and preference fallbacks without a yearly report', async () => {
    const { wrapper, find } = await render({
      allUnbudgeted: true,
      otherCurrencies: true,
      withoutPreferences: true,
      withoutYear: true,
      missingCurrency: true,
    })

    expect(find('budget-no-targets').exists()).toBe(true)
    expect(find('budget-currency-note').text()).toContain('USD')
    expect(find('budget-alert').exists()).toBe(false)
    expect(find('budget-year-chart').exists()).toBe(false)
    expect(find(`budget-category-${coffee.id}`).text()).toContain('No target set')
    wrapper.unmount()

    const noPreferences = await render({ withoutPreferences: true, missingCurrency: true })
    expect(noPreferences.wrapper.find('.budget-summary').text()).toContain('$')
    noPreferences.wrapper.unmount()
  })

  it('keeps safe defaults and no-ops until the first budget and link targets load', async () => {
    interface SetupState {
      currency: string
      title: string
      selectedBudgeted: string
      selectedCarried: string
      budgetedIncome: string
      receivedIncome: string
      visibleGroups: unknown[]
      unbudgeted: boolean
      noCategories: boolean
      nearLimitCount: number
      accountItems: { value: string }[]
      usedAmount: (line: BudgetLine) => string
      limitAmount: (line: BudgetLine) => string
      transactionAccount: (transaction: Transaction) => string
      accountScopeLabel: (categoryId: string) => string
      transactionUsedLabel: (kind: 'income' | 'expense') => string
      periodLabel: (period: 'weekly' | 'biweekly' | 'monthly' | 'yearly') => string
      subscriptionCanLink: (subscription: Subscription) => boolean
      subscriptionLink: (subscriptionId: string) => BudgetConfiguration | undefined
      transactionLink: (transactionId: string) => BudgetConfiguration | undefined
      subscriptionCategory: { id: string; name: string } | null
      saveBudget: () => Promise<void>
      removeBudget: () => Promise<void>
      loadLinkableTransactions: () => Promise<void>
      toggleTransactionLink: (transaction: Transaction) => Promise<void>
      toggleSubscriptionLink: (subscription: Subscription) => Promise<void>
    }
    const deferredMonths: { requests: DeferredMonth[] } = { requests: [] }
    const { wrapper } = await render({
      deferredMonths,
      withoutPreferences: true,
    })
    const setup = wrapper.vm.$.setupState as unknown as SetupState

    expect(setup.currency).toBe('USD')
    expect(setup.title).toContain('20')
    expect(setup.selectedBudgeted).toBe('0.00')
    expect(setup.selectedCarried).toBe('0.00')
    expect(setup.budgetedIncome).toBe('0.00')
    expect(setup.receivedIncome).toBe('0.00')
    expect(setup.visibleGroups).toEqual([])
    expect(setup.unbudgeted).toBe(false)
    expect(setup.noCategories).toBe(false)
    expect(setup.nearLimitCount).toBe(0)
    expect(setup.accountItems.map((item) => item.value)).not.toContain(canadianAccount.id)
    expect(setup.accountItems.some((item) => item.value === accountWithoutInstitution.id)).toBe(
      true,
    )
    expect(setup.usedAmount(line(travel, { period: 'yearly', amount: '1200.00' }))).toBe('0.00')
    expect(setup.limitAmount(line(travel, { period: 'yearly', amount: null }))).toBe('0.00')
    expect(setup.transactionAccount(orphanIncomeTransaction)).toBe('Account unavailable')
    expect(setup.accountScopeLabel('missing-category')).toBe('')
    expect(setup.transactionUsedLabel('income')).toBe('Received')
    expect(setup.transactionUsedLabel('expense')).toBe('Spent')
    expect(setup.periodLabel('weekly')).toBe('Weekly')
    expect(setup.subscriptionLink('missing-subscription')).toBeUndefined()
    expect(setup.transactionLink('missing-transaction')).toBeUndefined()
    expect(setup.subscriptionCanLink(powerSubscription)).toBe(false)
    await setup.saveBudget()
    await setup.removeBudget()
    await setup.loadLinkableTransactions()
    await setup.toggleTransactionLink(paycheckTransaction)
    await setup.toggleSubscriptionLink(powerSubscription)
    setup.subscriptionCategory = { id: paycheck.id, name: paycheck.name }
    expect(setup.subscriptionCanLink(powerSubscription)).toBe(true)

    const request = deferredMonths.requests[0]
    if (!request) throw new Error('The first budget request should be pending')
    request.resolve(makeMonth(request.month))
    await flushPromises()
    await flushPromises()
    wrapper.unmount()
  })

  it('offers category actions from the header menu', async () => {
    const { wrapper, find } = await render()
    await find('budget-add').trigger('click')
    await flushPromises()
    expect(find(`budget-menu-${coffee.id}`).text()).toContain('Set a budget')
    expect(find(`budget-menu-${groceries.id}`).text()).toContain('Edit budget')
    await find(`budget-menu-${coffee.id}`).trigger('click')
    await flushPromises()
    expect(page().find('[data-test="budget-editor"]').text()).toContain('Coffee')
    await find('budget-cancel').trigger('click')
    await find(`budget-edit-${paycheck.id}`).trigger('click')
    await flushPromises()
    expect(page().find('[data-test="budget-editor"]').text()).toContain('Income target')
    wrapper.unmount()
  })

  it('retries failed loads and handles an empty category setup', async () => {
    const failed = await render({ fail: true })
    expect(failed.find('budget-error').text()).toContain('Temporary problem')
    await failed.find('budget-retry').trigger('click')
    await flushPromises()
    expect(failed.find('budget-error').exists()).toBe(false)
    failed.wrapper.unmount()

    const empty = await render({ empty: true })
    expect(empty.find('budget-empty').text()).toContain('Give your money a plan')
    expect(empty.find('budget-create-category').attributes('href')).toBe('/settings/categories')
    empty.wrapper.unmount()
  })

  it('shows a no-results state and still searches configured account names', async () => {
    const { wrapper, find } = await render()
    await find('budget-search').find('input').setValue('not found')
    await flushPromises()
    expect(find('budget-no-results').text()).toContain('No matching categories')

    await find('budget-search').find('input').setValue('everyday checking')
    await flushPromises()
    expect(find(`budget-category-${groceries.id}`).exists()).toBe(true)
    await find('budget-search').find('input').setValue('food')
    await flushPromises()
    expect(find('budget-group-expense').exists()).toBe(true)
    await find('budget-search').find('input').setValue('groceries')
    await flushPromises()
    expect(find(`budget-category-${groceries.id}`).exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens an empty paycheck list and reports transaction load errors with retry', async () => {
    const { wrapper, find, transactionFetch } = await render()
    transactionFetch.mockRejectedValueOnce(new Error('Transactions unavailable'))

    await find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    expect(find('budget-transactions-error').text()).toContain('Transactions unavailable')
    await find('budget-transactions-retry').trigger('click')
    await flushPromises()
    expect(find(`budget-transaction-${paycheckTransaction.id}`).exists()).toBe(true)
    wrapper.unmount()

    const emptyTransactions = await render({ emptyTransactions: true })
    await emptyTransactions.find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    expect(emptyTransactions.find('empty-state').text()).toContain('No income this month yet')
    emptyTransactions.wrapper.unmount()

    const emptyPayments = await render({ emptyTransactions: true })
    await emptyPayments.find(`budget-link-expense-${groceries.id}`).trigger('click')
    await flushPromises()
    expect(emptyPayments.find('empty-state').text()).toContain('No payments this month yet')
    emptyPayments.wrapper.unmount()
  })

  it('reports subscription errors, handles empty lists and disables bills outside the budget scope', async () => {
    const failed = await render({ failSubscriptions: true })
    await failed.find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    expect(failed.find('budget-subscriptions-error').text()).toContain('Subscriptions unavailable')
    await failed.find('budget-subscriptions-retry').trigger('click')
    await flushPromises()
    expect(failed.find(`budget-link-subscription-${powerSubscription.id}`).exists()).toBe(true)
    expect(
      failed.find(`budget-link-subscription-${savingsSubscription.id}`).attributes('disabled'),
    ).toBeDefined()
    expect(
      failed.find(`budget-link-subscription-${canadianSubscription.id}`).attributes('disabled'),
    ).toBeDefined()
    expect(failed.find(`budget-subscription-${orphanSubscription.id}`).text()).toContain(
      'Account unavailable',
    )
    failed.linkSubscription.mockRejectedValueOnce(new Error('Subscription conflict'))
    await failed.find(`budget-link-subscription-${powerSubscription.id}`).trigger('click')
    await flushPromises()
    expect(notices.value.at(-1)).toMatchObject({
      text: "Couldn't update the subscription link. Subscription conflict",
      tone: 'error',
    })
    await failed.find('dialog-close').trigger('click')
    failed.wrapper.unmount()

    const empty = await render({ emptySubscriptions: true })
    await empty.find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    expect(empty.find('empty-state').text()).toContain('No subscriptions to link')
    empty.wrapper.unmount()

    const unavailable = await render({ linkedElsewhere: true })
    await unavailable.find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    expect(unavailable.find(`budget-subscription-${savingsSubscription.id}`).text()).toContain(
      'Linked elsewhere',
    )
    unavailable.wrapper.unmount()

    const allAccounts = await render({ allAccounts: true })
    await allAccounts.find(`budget-link-bills-${groceries.id}`).trigger('click')
    await flushPromises()
    expect(
      allAccounts.find(`budget-link-subscription-${savingsSubscription.id}`).attributes('disabled'),
    ).toBeUndefined()
    expect(
      allAccounts
        .find(`budget-link-subscription-${canadianSubscription.id}`)
        .attributes('disabled'),
    ).toBeDefined()
    await allAccounts.find('dialog-close').trigger('click')
    allAccounts.wrapper.unmount()
  })

  it('shows transaction account fallbacks and linked-elsewhere state, reporting link errors', async () => {
    const linkedElsewhere = await render({ linkedElsewhere: true })
    linkedElsewhere.link.mockRejectedValueOnce(new Error('Link conflict'))
    await linkedElsewhere.find(`budget-link-income-${paycheck.id}`).trigger('click')
    await flushPromises()
    expect(
      linkedElsewhere.find(`budget-transaction-${orphanIncomeTransaction.id}`).text(),
    ).toContain('Account unavailable')
    await linkedElsewhere.find(`budget-link-${paycheckTransaction.id}`).trigger('click')
    await flushPromises()
    expect(notices.value.at(-1)).toMatchObject({
      text: "Couldn't update the transaction link. Link conflict",
      tone: 'error',
    })

    await linkedElsewhere.find(`budget-link-expense-${groceries.id}`).trigger('click')
    await flushPromises()
    const billLink = page().find(
      `[aria-label="${billTransaction.payee} is linked to another budget"]`,
    )
    expect(billLink.text()).toContain('Linked elsewhere')
    expect(billLink.attributes('disabled')).toBeDefined()
    linkedElsewhere.wrapper.unmount()
  })
})
