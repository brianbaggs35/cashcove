import { flushPromises, type DOMWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as automationsApi from '@/api/automations'
import * as billsApi from '@/api/bills'
import * as api from '@/api/budget'
import type { BudgetKind, BudgetSource } from '@/api/budget'
import { ApiError } from '@/api/client'
import * as subscriptionsApi from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import { notices } from '@/composables/notify'
import { makeAutomation } from '@/test/automations'
import { makeBudget, makeSource } from '@/test/budgets'
import { page } from '@/test/dom'
import {
  coffee,
  checking,
  makeAccount,
  groceries,
  latte,
  makePage,
  makeTransaction,
  paycheck,
  salary,
  savings,
  seedFinance,
  visa,
  wholeFoods,
} from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import BudgetLinkDialog from '@/views/budget/BudgetLinkDialog.vue'

const shouty = makeTransaction({ id: 'transaction-shouty', payee: ' WHOLE FOODS ' })

interface Options {
  kind?: BudgetKind
  sources?: BudgetSource[]
  transactions?: ReturnType<typeof makeTransaction>[]
  /** The API can't list the automations. */
  rulesFail?: boolean
  accounts?: ReturnType<typeof makeAccount>[]
}

async function render({
  kind = 'spending',
  sources = [],
  transactions,
  rulesFail = false,
  accounts = [checking, savings, visa],
}: Options = {}) {
  const open = ref(false)
  const added = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(BudgetLinkDialog, {
        budget: makeBudget(),
        kind,
        sources,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onAdded: added,
      }),
  })
  const fetchTransactions = vi
    .spyOn(transactionsApi, 'fetchTransactions')
    .mockResolvedValue(makePage(transactions ?? [wholeFoods, shouty, latte, salary]))
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([
    makeSubscription(),
    makeSubscription({ id: 'subscription-gym', name: 'Gym', amount: '30.00' }),
    makeSubscription({ id: 'subscription-old', name: 'Old magazine', active: false }),
  ])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([
    makeBill(),
    makeBill({ id: 'bill-water', name: 'Water', amount: '41.20', expected_amount: '41.20' }),
    makeBill({ id: 'bill-old', name: 'Old gas', active: false }),
  ])
  const fetchRules = vi.spyOn(automationsApi, 'fetchAutomations')
  if (rulesFail) fetchRules.mockRejectedValue(new Error('Offline'))
  else {
    fetchRules.mockResolvedValue([
      makeAutomation(),
      makeAutomation({
        id: 'automation-paycheck',
        name: 'Paycheck',
        payees: ['Acme Corp', 'Acme'],
      }),
    ])
  }
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance({ accounts }),
  })
  open.value = true
  await flushPromises()
  const overlay = () => page().find('.v-overlay--active .app-dialog')
  const field = (name: string) => overlay().find(`[data-test="link-${name}"]`)
  const tab = async (name: string) => {
    await overlay().find(`[data-test="link-tab-${name}"]`).trigger('click')
    await flushPromises()
  }
  const select = (name: 'account' | 'subscription' | 'bill' | 'rule') =>
    mounted.wrapper
      .findAllComponents({ name: 'VSelect' })
      .find((item) => item.attributes('data-test') === `link-${name}`)!
  const picks = () => overlay().findAll('[data-test="link-pick"] input')
  return {
    ...mounted,
    open,
    added,
    fetchTransactions,
    fetchRules,
    overlay,
    field,
    tab,
    select,
    picks,
  }
}

const titles = (items: { title: string }[]) => items.map((item) => item.title)
const text = (wrapper: DOMWrapper<Element>) => wrapper.text().replace(/\s+/g, ' ')

describe('BudgetLinkDialog', () => {
  it('adds spending, starting with the money that went out, and offers subscriptions and bills', async () => {
    const { overlay, field, fetchTransactions } = await render()

    expect(overlay().find('h2').text()).toBe('Add spending')
    expect(overlay().text()).toContain('Choose what counts as spending in Household.')
    expect(
      overlay()
        .findAll('[role="tab"]')
        .map((item) => item.text()),
    ).toEqual(['Transactions', 'An account', 'A category', 'A subscription', 'A bill', 'A rule'])
    expect(fetchTransactions).toHaveBeenCalledWith(expect.objectContaining({ direction: 'out' }))
    expect(field('add').attributes('disabled')).toBeDefined()
    expect(field('add').text()).toBe('Add transactions')
  })

  it('adds income, which has no subscriptions or bills, starting with the money that came in', async () => {
    const { overlay, fetchTransactions } = await render({ kind: 'income' })

    expect(overlay().find('h2').text()).toBe('Add income')
    expect(
      overlay()
        .findAll('[role="tab"]')
        .map((item) => item.text()),
    ).toEqual(['Transactions', 'An account', 'A category', 'A rule'])
    expect(fetchTransactions).toHaveBeenCalledWith(expect.objectContaining({ direction: 'in' }))
    expect(overlay().text()).toContain('Tick the money that came in, like your paycheck.')
  })

  it('counts spending either way, since what comes back takes it off', async () => {
    const create = vi
      .spyOn(automationsApi, 'createAutomation')
      .mockResolvedValue({ ...makeAutomation(), applied: 0 })
    const { field, picks } = await render({ kind: 'spending' })
    await picks()[0]!.setValue(true)

    await field('add').trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'any',
        counts: [{ budget_id: 'budget-monthly', kind: 'spending' }],
      }),
    )
  })

  it('counts every later transaction like the ones ticked, which makes an automation', async () => {
    const create = vi
      .spyOn(automationsApi, 'createAutomation')
      .mockResolvedValue({ ...makeAutomation(), applied: 0 })
    const { field, picks, added, open } = await render({ kind: 'income' })

    await picks()[0]!.setValue(true)
    await picks()[2]!.setValue(true)
    expect(text(field('automate'))).toContain('Count every later one like them, too')
    expect(text(field('automate-hint'))).toContain(
      'Cashcove counts every transaction from Whole Foods and 1 more, past and future',
    )
    await field('add').trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith({
      name: 'Whole Foods and 1 more (Household)',
      payees: ['Whole Foods', 'Blue Bottle'],
      match: 'exact',
      // Income is money that came in, so what was paid to the same names isn't counted as it.
      direction: 'in',
      account_id: null,
      min_amount: null,
      max_amount: null,
      category_id: null,
      subscription_id: null,
      counts: [{ budget_id: 'budget-monthly', kind: 'income' }],
      apply_to: 'all',
    })
    expect(notices.value.at(-1)?.text).toBe(
      'Counting Whole Foods and 1 more as income in Household, now and from now on',
    )
    expect(added).toHaveBeenCalled()
    expect(open.value).toBe(false)
  })

  it('counts one payee once, whichever way it is written', async () => {
    const create = vi
      .spyOn(automationsApi, 'createAutomation')
      .mockResolvedValue({ ...makeAutomation(), applied: 0 })
    const { field, picks } = await render()

    await picks()[0]!.setValue(true)
    await picks()[1]!.setValue(true)
    await field('add').trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ payees: ['Whole Foods'], name: 'Whole Foods (Household)' }),
    )
  })

  it('links just the transactions ticked when later ones are not to be counted', async () => {
    const link = vi.spyOn(api, 'linkBudgetTransactions').mockResolvedValue({ count: 1 })
    const create = vi.spyOn(automationsApi, 'createAutomation')
    const { field, picks, added } = await render()

    await picks()[0]!.setValue(true)
    await field('automate-switch').find('input').setValue(false)
    expect(text(field('automate-hint'))).toBe(
      'Only the transaction you ticked count. You can take one off the budget later.',
    )
    await field('add').trigger('click')
    await flushPromises()

    expect(create).not.toHaveBeenCalled()
    expect(link).toHaveBeenCalledWith('budget-monthly', ['transaction-groceries'], 'spending')
    expect(notices.value.at(-1)?.text).toBe('Counted 1 transaction as spending in Household')
    expect(added).toHaveBeenCalled()
  })

  it('links several transactions, and unticking one leaves it out', async () => {
    const link = vi.spyOn(api, 'linkBudgetTransactions').mockResolvedValue({ count: 2 })
    const { field, picks } = await render()

    await picks()[0]!.setValue(true)
    await picks()[2]!.setValue(true)
    await picks()[3]!.setValue(true)
    await picks()[3]!.setValue(false)
    await field('automate-switch').find('input').setValue(false)
    expect(text(field('automate-hint'))).toContain('Only the 2 transactions you ticked')
    await field('add').trigger('click')
    await flushPromises()

    expect(link).toHaveBeenCalledWith(
      'budget-monthly',
      ['transaction-groceries', 'transaction-latte'],
      'spending',
    )
    expect(notices.value.at(-1)?.text).toBe('Counted 2 transactions as spending in Household')
  })

  it('counts a whole account, but not one that already counts', async () => {
    const add = vi
      .spyOn(api, 'addBudgetSource')
      .mockResolvedValue({ ...makeSource(), name: 'Rewards Visa' })
    const { field, tab, select, added } = await render({
      sources: [
        makeSource({ type: 'account', target_id: checking.id, name: 'Everyday checking' }),
        makeSource({
          id: 'income-savings',
          kind: 'income',
          type: 'account',
          target_id: savings.id,
        }),
      ],
    })

    await tab('account')
    // Everyday checking counts as spending already; the savings account counts as income.
    expect(titles(select('account').props('items'))).toEqual(['Rainy day fund', 'Rewards Visa'])
    select('account').vm.$emit('update:modelValue', visa.id)
    await flushPromises()
    expect(field('add').text()).toBe('Count this account')
    await field('add').trigger('click')
    await flushPromises()

    expect(add).toHaveBeenCalledWith('budget-monthly', { kind: 'spending', account_id: visa.id })
    expect(notices.value.at(-1)?.text).toBe('Counting Rewards Visa as spending in Household')
    expect(added).toHaveBeenCalled()
  })

  it('counts the money coming into an account as income, and offers accounts with no institution', async () => {
    const cash = makeAccount({ id: 'account-cash', name: 'Cash', institution: null })
    const { overlay, tab, select } = await render({ kind: 'income', accounts: [cash, checking] })

    await tab('account')

    expect(overlay().text()).toContain(
      'All the money that comes into this account counts as income.',
    )
    expect(select('account').props('items')).toEqual([
      { value: 'account-cash', title: 'Cash', props: { subtitle: undefined } },
      {
        value: 'account-checking',
        title: 'Everyday checking',
        props: { subtitle: 'Harbor Credit Union' },
      },
    ])
  })

  it('closes from the dialog’s own close button', async () => {
    const { open } = await render()

    await page().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
  })

  it('counts a category', async () => {
    const add = vi.spyOn(api, 'addBudgetSource').mockResolvedValue({ ...makeSource() })
    const { wrapper, field, tab } = await render({ kind: 'income' })

    await tab('category')
    wrapper.findComponent({ name: 'CategoryPicker' }).vm.$emit('update:modelValue', paycheck.id)
    await flushPromises()
    expect(field('add').text()).toBe('Count this category')
    await field('add').trigger('click')
    await flushPromises()

    expect(add).toHaveBeenCalledWith('budget-monthly', { kind: 'income', category_id: paycheck.id })
  })

  it('counts a subscription that does not count yet', async () => {
    const add = vi.spyOn(api, 'addBudgetSource').mockResolvedValue({ ...makeSource(), name: 'Gym' })
    const { field, tab, select } = await render({
      sources: [makeSource({ type: 'subscription', target_id: 'subscription-streamflix' })],
    })

    await tab('subscription')
    expect(titles(select('subscription').props('items'))).toEqual(['Gym'])
    expect(select('subscription').props('items')[0].props.subtitle).toBe('Monthly · $30.00')
    select('subscription').vm.$emit('update:modelValue', 'subscription-gym')
    await flushPromises()
    await field('add').trigger('click')
    await flushPromises()

    expect(add).toHaveBeenCalledWith('budget-monthly', {
      kind: 'spending',
      subscription_id: 'subscription-gym',
    })
  })

  it('counts a bill that does not count yet, the way a subscription is', async () => {
    const add = vi
      .spyOn(api, 'addBudgetSource')
      .mockResolvedValue({ ...makeSource(), type: 'bill', name: 'Water' })
    const { field, tab, select } = await render({
      // The bill counted already isn't offered again, and a subscription doesn't hide a bill.
      sources: [
        makeSource({ type: 'bill', target_id: 'bill-power' }),
        makeSource({ type: 'subscription', target_id: 'subscription-streamflix' }),
      ],
    })

    await tab('bill')
    expect(field('add').text()).toBe('Count this bill')
    expect(field('add').attributes('disabled')).toBeDefined()
    expect(titles(select('bill').props('items'))).toEqual(['Water'])
    expect(select('bill').props('items')[0].props.subtitle).toBe('Monthly · $41.20')
    select('bill').vm.$emit('update:modelValue', 'bill-water')
    await flushPromises()
    await field('add').trigger('click')
    await flushPromises()

    // A bill is linked by the ID it has, like a subscription.
    expect(add).toHaveBeenCalledWith('budget-monthly', {
      kind: 'spending',
      subscription_id: 'bill-water',
    })
    expect(notices.value.at(-1)?.text).toBe('Counting Water as spending in Household')
  })

  it('counts an automation that does not count yet', async () => {
    const add = vi
      .spyOn(api, 'addBudgetSource')
      .mockResolvedValue({ ...makeSource(), name: 'Paycheck' })
    const { field, tab, select, fetchRules } = await render({
      kind: 'income',
      sources: [makeSource({ type: 'automation', target_id: 'automation-streaming' })],
    })

    await tab('rule')
    expect(fetchRules).toHaveBeenCalledTimes(1)
    expect(titles(select('rule').props('items'))).toEqual(['Paycheck'])
    expect(select('rule').props('items')[0].props.subtitle).toBe('Acme Corp, Acme')
    select('rule').vm.$emit('update:modelValue', 'automation-paycheck')
    await flushPromises()
    await field('add').trigger('click')
    await flushPromises()

    expect(add).toHaveBeenCalledWith('budget-monthly', {
      kind: 'income',
      automation_id: 'automation-paycheck',
    })
  })

  it('has no rules to offer when they could not be loaded', async () => {
    const { tab, select, field } = await render({ rulesFail: true })

    await tab('rule')

    expect(select('rule').props('items')).toEqual([])
    expect(field('add').attributes('disabled')).toBeDefined()
  })

  it('shows what the API turned down, and stays open', async () => {
    vi.spyOn(api, 'addBudgetSource').mockRejectedValue(
      new ApiError(409, 'That already counts toward this budget.', { code: 'already_counted' }),
    )
    const { wrapper, field, tab, open, added } = await render()
    await tab('category')
    wrapper.findComponent({ name: 'CategoryPicker' }).vm.$emit('update:modelValue', groceries.id)
    await flushPromises()

    await field('add').trigger('click')
    await flushPromises()

    expect(field('error').text()).toBe('That already counts toward this budget.')
    expect(open.value).toBe(true)
    expect(added).not.toHaveBeenCalled()
    wrapper.findComponent({ name: 'CategoryPicker' }).vm.$emit('update:modelValue', coffee.id)
  })

  it('starts afresh each time it is opened, and closes without adding anything', async () => {
    const add = vi.spyOn(api, 'addBudgetSource')
    const { overlay, field, picks, tab, open } = await render()
    await picks()[0]!.setValue(true)
    await tab('account')
    expect(field('add').attributes('disabled')).toBeDefined()

    await overlay()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    expect(open.value).toBe(false)
    open.value = true
    await flushPromises()

    expect(overlay().find('[data-test="link-tab-transactions"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(picks().filter((pick) => (pick.element as HTMLInputElement).checked)).toHaveLength(0)
    expect(add).not.toHaveBeenCalled()
  })
})
