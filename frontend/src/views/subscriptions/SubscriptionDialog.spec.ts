import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import type { Subscription } from '@/api/subscriptions'
import * as subscriptionsApi from '@/api/subscriptions'
import { ApiError } from '@/api/client'
import * as transactionsApi from '@/api/transactions'
import { notices } from '@/composables/notify'
import { checking, makeAccount, makePage, savings, seedFinance, wholeFoods } from '@/test/finance'
import { page } from '@/test/dom'
import { makeSubscription } from '@/test/subscriptions'
import { mountWithPlugins } from '@/test/mount'
import { addDays, todayIso } from '@/utils/dates'
import SubscriptionDialog from '@/views/subscriptions/SubscriptionDialog.vue'

interface Options {
  subscription?: Subscription | null
  accounts?: (typeof checking)[]
  transactionFailure?: unknown
}

async function render({
  subscription = null,
  accounts = [checking, savings],
  transactionFailure,
}: Options = {}) {
  const open = ref(false)
  const saved = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(SubscriptionDialog, {
        subscription,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
      }),
  })
  const fetch = vi.spyOn(transactionsApi, 'fetchTransactions')
  if (transactionFailure) fetch.mockRejectedValue(transactionFailure)
  else fetch.mockResolvedValue(makePage([wholeFoods]))
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance({ accounts }),
  })
  open.value = true
  await flushPromises()
  const overlay = () => page().find('.v-overlay--active .app-dialog')
  const field = (name: string) => overlay().find(`[data-test="subscription-${name}"]`)
  const input = (name: string) => field(name).find('input:not([type="hidden"]), textarea')
  const value = (name: string) => (input(name).element as HTMLInputElement).value
  return {
    ...mounted,
    open,
    saved,
    fetch,
    overlay,
    field,
    input,
    value,
    component: (name: string) => mounted.wrapper.findComponent({ name }),
  }
}

async function makeFormValid(wrapper: VueWrapper) {
  wrapper.findComponent({ name: 'VForm' }).vm.$emit('update:modelValue', true)
  await flushPromises()
}

describe('SubscriptionDialog', () => {
  it('defaults account, amount schedule, next due date and transaction choices', async () => {
    const { overlay, field, value, fetch } = await render()

    expect(overlay().find('h2').text()).toBe('Add a subscription')
    expect(value('name')).toBe('')
    expect(value('amount')).toBe('')
    expect(value('due-date')).not.toBe('')
    expect(field('frequency').text()).toContain('Monthly')
    expect(field('account').text()).toContain('Everyday checking')
    expect(field('seed-transaction').text()).toContain('Link a past payment')
    expect(fetch).toHaveBeenCalledWith({
      account_id: [checking.id],
      direction: 'out',
      page_size: 200,
    })
  })

  it('selects a past payment, copies its merchant and amount, and creates the rule', async () => {
    const created = makeSubscription({
      name: 'Grocery delivery',
      payee: 'Whole Foods',
      amount: '84.12',
      payment_count: 1,
    })
    const create = vi.spyOn(subscriptionsApi, 'createSubscription').mockResolvedValue(created)
    const { wrapper, field, input, value, saved, open, component } = await render()
    await input('name').setValue('Grocery delivery')
    component('SubscriptionDialog')
      .findComponent({ name: 'VAutocomplete' })
      .vm.$emit('update:modelValue', wholeFoods.id)
    await flushPromises()
    expect(value('payee')).toBe('Whole Foods')
    expect(value('amount')).toBe('84.12')
    await makeFormValid(wrapper)
    await field('save').trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith({
      name: 'Grocery delivery',
      payee: 'Whole Foods',
      amount: '84.12',
      amount_varies: false,
      frequency: 'monthly',
      account_id: checking.id,
      next_due_date: addDays(todayIso(), 30),
      category_id: null,
      notes: null,
      seed_transaction_id: wholeFoods.id,
    })
    expect(saved).toHaveBeenCalledWith(created)
    expect(open.value).toBe(false)
    expect(notices.value.at(-1)?.text).toBe('Added Grocery delivery')
  })

  it('creates a rule without a historical payment using its name as the payee', async () => {
    const dueDate = addDays(todayIso(), 14)
    const create = vi.spyOn(subscriptionsApi, 'createSubscription').mockResolvedValue(
      makeSubscription({
        name: 'Cloud Box',
        payee: 'Cloud Box billing',
        frequency: 'quarterly',
        next_due_date: dueDate,
        category_id: wholeFoods.category_id,
        notes: 'Family storage',
      }),
    )
    const { wrapper, field, input, open, component } = await render()
    await input('name').setValue('Cloud Box')
    await input('amount').setValue('8.00')
    await input('payee').setValue('Cloud Box billing')
    await input('notes').setValue('Family storage')
    component('SubscriptionDialog')
      .findAllComponents({ name: 'VSelect' })
      .at(0)!
      .vm.$emit('update:modelValue', 'quarterly')
    component('SubscriptionDialog')
      .findComponent({ name: 'DateField' })
      .vm.$emit('update:modelValue', dueDate)
    component('SubscriptionDialog')
      .findComponent({ name: 'CategoryPicker' })
      .vm.$emit('update:modelValue', wholeFoods.category_id)
    await flushPromises()
    await makeFormValid(wrapper)
    await field('save').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      name: 'Cloud Box',
      payee: 'Cloud Box billing',
      amount: '8.00',
      amount_varies: false,
      frequency: 'quarterly',
      account_id: checking.id,
      next_due_date: dueDate,
      category_id: wholeFoods.category_id,
      notes: 'Family storage',
      seed_transaction_id: null,
    })
    expect(open.value).toBe(false)
  })

  it('validates blank and overlong names and notes, and missing payment accounts', async () => {
    const closedAccount = makeAccount({
      id: 'closed-account',
      name: 'Closed card',
      institution: null,
      closed_at: '2026-01-01T00:00:00Z',
    })
    const { component } = await render({
      subscription: makeSubscription({
        account_id: closedAccount.id,
        category_id: null,
      }),
      accounts: [closedAccount],
    })
    const dialog = component('SubscriptionDialog')
    const nameRules = dialog.findAllComponents({ name: 'VTextField' }).at(0)!.props('rules') as ((
      value: string,
    ) => true | string)[]
    const notesRules = dialog.findComponent({ name: 'VTextarea' }).props('rules') as ((
      value: string,
    ) => true | string)[]
    const accountRules = dialog.findAllComponents({ name: 'VSelect' }).at(1)!.props('rules') as ((
      value: string | null,
    ) => true | string)[]

    expect(nameRules[0]!('   ')).toBe('Give this subscription a name')
    expect(nameRules[0]!('Cloud Box')).toBe(true)
    expect(nameRules[1]!('x'.repeat(121))).toBe('Keep it under 120 characters')
    expect(nameRules[1]!('Cloud Box')).toBe(true)
    expect(notesRules[0]!('x'.repeat(1001))).toBe('Keep notes under 1,000 characters')
    expect(notesRules[0]!('Family storage')).toBe(true)
    expect(accountRules[0]!(null)).toBe('Choose an account')
    expect(accountRules[0]!(closedAccount.id)).toBe(true)
    expect(dialog.findAllComponents({ name: 'VAutocomplete' }).at(0)!.props('items')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Whole Foods · Sep 18',
          props: expect.objectContaining({ subtitle: '$84.12 · Closed card' }),
        }),
      ]),
    )
  })

  it('renders payment choices when the selected account is no longer available', async () => {
    const { component } = await render({
      subscription: makeSubscription({
        account_id: 'deleted-account',
        category_id: null,
      }),
    })
    const items = component('SubscriptionDialog')
      .findAllComponents({ name: 'VAutocomplete' })
      .at(0)!
      .props('items')
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          props: expect.objectContaining({ subtitle: '$84.12 · ' }),
        }),
      ]),
    )
  })

  it('closes from the shared dialog close button', async () => {
    const { component, open } = await render()
    await page().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(component('AppDialog').props('modelValue')).toBe(false)
  })

  it('says the amount is an estimate for a bill that changes every time, and sends that', async () => {
    const subscription = makeSubscription({ name: 'Power', amount: '96.40', amount_varies: true })
    const update = vi.spyOn(subscriptionsApi, 'updateSubscription').mockResolvedValue(subscription)
    const { wrapper, field, saved, component } = await render({ subscription })

    expect(field('amount').text()).toContain('Estimated amount')
    expect((field('varies').find('input').element as HTMLInputElement).checked).toBe(true)
    component('SubscriptionDialog')
      .findAllComponents({ name: 'VSwitch' })
      .find((item) => item.attributes('data-test') === 'subscription-varies')!
      .vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(field('amount').text()).toContain('Payment amount')
    component('SubscriptionDialog')
      .findAllComponents({ name: 'VSwitch' })
      .find((item) => item.attributes('data-test') === 'subscription-varies')!
      .vm.$emit('update:modelValue', true)
    await makeFormValid(wrapper)
    await field('save').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(
      subscription.id,
      expect.objectContaining({ amount: '96.40', amount_varies: true }),
    )
    expect(saved).toHaveBeenCalled()
  })

  it('closes from the cancel action', async () => {
    const { open } = await render()
    const cancel = page()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')
    await cancel!.trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('updates an existing subscription including pause and category changes', async () => {
    const subscription = makeSubscription()
    const update = vi.spyOn(subscriptionsApi, 'updateSubscription').mockResolvedValue({
      ...subscription,
      name: 'Streamflix Premium',
      active: false,
    })
    const { wrapper, field, input, saved, component } = await render({ subscription })
    expect(field('active').exists()).toBe(true)
    await input('name').setValue('Streamflix Premium')
    component('SubscriptionDialog')
      .findAllComponents({ name: 'VSwitch' })
      .find((item) => item.attributes('data-test') === 'subscription-active')!
      .vm.$emit('update:modelValue', false)
    await makeFormValid(wrapper)
    await field('save').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(
      subscription.id,
      expect.objectContaining({
        name: 'Streamflix Premium',
        active: false,
        seed_transaction_id: null,
      }),
    )
    expect(saved).toHaveBeenCalledOnce()
    expect(notices.value.at(-1)?.text).toBe('Saved the subscription')
  })

  it('reloads payment choices after the account changes and clears the previous selection', async () => {
    const { fetch, component, field } = await render()
    const account = component('SubscriptionDialog').findAllComponents({ name: 'VSelect' }).at(1)!
    account.vm.$emit('update:modelValue', checking.id)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(1)
    account.vm.$emit('update:modelValue', savings.id)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.at(-1)?.[0]).toMatchObject({ account_id: [savings.id] })
    const seed = component('SubscriptionDialog').findAllComponents({ name: 'VAutocomplete' }).at(0)!
    seed.vm.$emit('update:modelValue', null)
    seed.vm.$emit('update:modelValue', 'missing-transaction')
    await flushPromises()
    expect(field('seed-transaction').exists()).toBe(true)
  })

  it('ignores stale payment lookup results and errors after changing accounts', async () => {
    const { fetch, component, field } = await render()
    const pending: {
      accountId: string
      resolve: (value: Awaited<ReturnType<typeof transactionsApi.fetchTransactions>>) => void
      reject: (reason?: unknown) => void
    }[] = []
    fetch.mockImplementation(
      (query) =>
        new Promise((resolve, reject) => {
          pending.push({ accountId: query?.account_id?.[0] ?? '', resolve, reject })
        }),
    )
    const account = component('SubscriptionDialog').findAllComponents({ name: 'VSelect' }).at(1)!
    account.vm.$emit('update:modelValue', savings.id)
    account.vm.$emit('update:modelValue', checking.id)
    expect(pending.map((item) => item.accountId)).toEqual([savings.id, checking.id])

    pending[1]!.resolve(makePage([wholeFoods]))
    await flushPromises()
    pending[0]!.resolve(makePage([]))
    await flushPromises()

    account.vm.$emit('update:modelValue', savings.id)
    account.vm.$emit('update:modelValue', checking.id)
    pending[2]!.reject(new Error('Old account unavailable'))
    pending[3]!.resolve(makePage([]))
    await flushPromises()
    expect(field('seed-transaction').text()).not.toContain('Old account unavailable')
  })

  it('shows transaction lookup failures without hiding the subscription form', async () => {
    const { field, overlay } = await render({
      transactionFailure: new Error('Transactions are unavailable'),
    })
    expect(field('seed-transaction').text()).toContain('Transactions are unavailable')
    expect(overlay().find('h2').text()).toBe('Add a subscription')
  })

  it('shows non-Error transaction lookup failures as text', async () => {
    const { field } = await render({ transactionFailure: 'Payment history is unavailable' })
    expect(field('seed-transaction').text()).toContain('Payment history is unavailable')
  })

  it('keeps the form usable when the household has no open accounts', async () => {
    const { fetch, field } = await render({ accounts: [] })
    expect(fetch).not.toHaveBeenCalled()
    expect(field('save').attributes('disabled')).toBeDefined()
    expect(field('seed-transaction').exists()).toBe(true)
  })

  it('shows field-specific errors from the API and clears them on edit', async () => {
    vi.spyOn(subscriptionsApi, 'createSubscription').mockRejectedValue(
      new ApiError(422, 'Check the amount.', { fields: { amount: 'Enter a valid amount.' } }),
    )
    const { wrapper, field, input } = await render()
    await input('name').setValue('Cloud Box')
    await input('amount').setValue('8.00')
    await makeFormValid(wrapper)
    await field('save').trigger('click')
    await flushPromises()
    expect(field('error').exists()).toBe(false)
    expect(field('amount').text()).toContain('Enter a valid amount.')
    await input('amount').setValue('9.00')
    await flushPromises()
    expect(field('amount').text()).not.toContain('Enter a valid amount.')
  })

  it('shows a general API failure when there are no field errors', async () => {
    vi.spyOn(subscriptionsApi, 'createSubscription').mockRejectedValue(new Error('Try again later'))
    const { wrapper, field, input } = await render()
    await input('name').setValue('Cloud Box')
    await input('amount').setValue('8.00')
    await makeFormValid(wrapper)
    await field('save').trigger('click')
    await flushPromises()
    expect(field('error').text()).toContain('Try again later')
  })

  it('does not submit until the form is valid', async () => {
    const create = vi.spyOn(subscriptionsApi, 'createSubscription')
    const { component } = await render()
    await component('SubscriptionDialog').findComponent({ name: 'VForm' }).trigger('submit')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
  })
})
