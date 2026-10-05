import { flushPromises, type DOMWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as automationsApi from '@/api/automations'
import * as billsApi from '@/api/bills'
import * as budgetApi from '@/api/budget'
import type {
  Automation,
  AutomationPreview,
  AutomationSaved,
  PreviewRequest,
} from '@/api/automations'
import { ApiError } from '@/api/client'
import * as subscriptionsApi from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import type { Transaction } from '@/api/transactions'
import { notices } from '@/composables/notify'
import { makeAutomation } from '@/test/automations'
import { makeBudget } from '@/test/budgets'
import { page } from '@/test/dom'
import {
  checking,
  groceries,
  latte,
  makeAccount,
  makePage,
  makeTransaction,
  savings,
  seedFinance,
  wholeFoods,
} from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import AutomationDialog from '@/views/automations/AutomationDialog.vue'
import { kinds } from '@/views/subscriptions/kinds'

const shouty = makeTransaction({ id: 'transaction-shouty', payee: ' WHOLE FOODS ' })

interface Options {
  automation?: Automation | null
  accounts?: (typeof checking)[]
  preview?: AutomationPreview
  seed?: Transaction[]
}

async function render({
  automation = null,
  accounts = [checking, savings],
  preview = { matching: 4, overlaps: [] },
  seed = [],
}: Options = {}) {
  const open = ref(false)
  const saved = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(AutomationDialog, {
        automation,
        seed,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
      }),
  })
  vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(
    makePage([wholeFoods, shouty, latte]),
  )
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([
    makeSubscription(),
    makeSubscription({ id: 'subscription-paused', name: 'Old gym', active: false }),
  ])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([
    makeBill(),
    makeBill({ id: 'bill-old', name: 'Old gas', active: false }),
  ])
  vi.spyOn(budgetApi, 'fetchBudgets').mockResolvedValue([
    makeBudget(),
    makeBudget({ id: 'budget-yearly', name: 'Year plan', period: 'yearly' }),
  ])
  const previewApi = vi.spyOn(automationsApi, 'previewAutomation').mockResolvedValue(preview)
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance({ accounts }),
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  open.value = true
  await flushPromises()
  const overlay = () => page().find('.v-overlay--active .app-dialog')
  const field = (name: string) => overlay().find(`[data-test="automation-${name}"]`)
  const input = (name: string) => field(name).find('input:not([type="hidden"]), textarea')
  const value = (name: string) => (input(name).element as HTMLInputElement).value
  const picks = () => overlay().findAll('[data-test="automation-pick"] input')
  const chosen = () =>
    overlay()
      .findAll('[data-test="automation-chosen-payee"]')
      .map((chip) => chip.text())
  /** Lets the preview that follows a change to what is looked for come back. */
  const settle = async () => {
    vi.advanceTimersByTime(250)
    await flushPromises()
  }
  return {
    ...mounted,
    open,
    saved,
    previewApi,
    overlay,
    field,
    input,
    value,
    picks,
    chosen,
    settle,
    /** Goes on to what should happen. */
    next: async () => {
      await field('next').trigger('click')
      await flushPromises()
    },
    /** Chooses which amounts to match. */
    choose: async (label: string) => {
      await field('amount-mode')
        .findAll('button')
        .find((button) => button.text() === label)!
        .trigger('click')
    },
    budgets: (name: 'income' | 'spending') =>
      mounted.wrapper
        .findAllComponents({ name: 'VSelect' })
        .find((item) => item.attributes('data-test') === `automation-${name}-budgets`)!,
    select: (name: 'match' | 'account' | 'subscription') =>
      mounted.wrapper
        .findAllComponents({ name: 'VSelect' })
        .find((select) => select.attributes('data-test') === `automation-${name}`)!,
    category: () => mounted.wrapper.findComponent({ name: 'CategoryPicker' }),
  }
}

async function makeFormValid(wrapper: Awaited<ReturnType<typeof render>>['wrapper']) {
  wrapper.findComponent({ name: 'VForm' }).vm.$emit('update:modelValue', true)
  await flushPromises()
}

const text = (wrapper: DOMWrapper<Element>) => wrapper.text().replace(/\s+/g, ' ')

describe('AutomationDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('finding transactions', () => {
    it('starts there, with nothing to go on with until something is looked for', async () => {
      const { overlay, field, picks, previewApi } = await render()

      expect(overlay().find('h2').text()).toBe('New automation')
      expect(overlay().text()).toContain('Tick transactions, or type what to look for.')
      expect(picks()).toHaveLength(3)
      expect(field('preview').text()).toBe(
        'Nothing yet. Tick a transaction below, or type what to look for.',
      )
      expect(field('looks').text()).toBe('Exactly · any account · any amount')
      expect(field('next').attributes('disabled')).toBeDefined()
      expect(field('back').exists()).toBe(false)
      expect(field('save').exists()).toBe(false)
      expect(previewApi).not.toHaveBeenCalled()
    })

    it('ticks transactions to choose payees, naming the automation after them', async () => {
      const { field, value, picks, chosen, previewApi, settle } = await render()

      await picks()[0]!.setValue(true)
      expect(chosen()).toEqual(['Whole Foods'])
      expect(value('name')).toBe('Whole Foods')
      await picks()[2]!.setValue(true)
      expect(chosen()).toEqual(['Whole Foods', 'Blue Bottle'])
      expect(value('name')).toBe('Whole Foods and 1 more')
      // The same payee in other letters is ticked already, and unticking it takes the payee out.
      expect(picks()[1]!.element).toHaveProperty('checked', true)
      expect(field('next').attributes('disabled')).toBeUndefined()

      await settle()
      expect(previewApi).toHaveBeenCalledTimes(1)
      expect(previewApi).toHaveBeenCalledWith({
        payees: ['Whole Foods', 'Blue Bottle'],
        match: 'exact',
        accountId: null,
        minAmount: null,
        maxAmount: null,
        automationId: null,
        category: false,
        subscription: false,
      } satisfies PreviewRequest)
      expect(field('preview').text()).toBe('Matches 4 transactions you have now.')

      await picks()[1]!.setValue(false)
      expect(chosen()).toEqual(['Blue Bottle'])
      expect(value('name')).toBe('Blue Bottle')
    })

    it('says when one transaction matches', async () => {
      const { field, picks, settle } = await render({ preview: { matching: 1, overlaps: [] } })

      await picks()[0]!.setValue(true)
      await settle()

      expect(field('preview').text()).toBe('Matches 1 transaction you have now.')
    })

    it('looks for text that was typed, from the button or the keyboard, once for each', async () => {
      const { field, input, value, chosen, previewApi, settle } = await render()
      expect(field('text-add').attributes('disabled')).toBeDefined()

      await input('text').setValue('  Netflix ')
      expect(field('text-add').attributes('disabled')).toBeUndefined()
      await field('text-add').trigger('click')
      expect(chosen()).toEqual(['Netflix'])
      expect(value('text')).toBe('')
      expect(value('name')).toBe('Netflix')

      await input('text').setValue('NETFLIX')
      await input('text').trigger('keydown', { key: 'Enter' })
      expect(chosen()).toEqual(['Netflix'])
      expect(value('text')).toBe('')

      await input('text').setValue('Hulu')
      await input('text').trigger('keydown', { key: 'Enter' })
      expect(chosen()).toEqual(['Netflix', 'Hulu'])

      await input('text').setValue('   ')
      await input('text').trigger('keydown', { key: 'Enter' })
      expect(chosen()).toEqual(['Netflix', 'Hulu'])
      await settle()
      expect(previewApi).toHaveBeenCalledTimes(1)
    })

    it('keeps a name that was typed, however the payees change', async () => {
      const { overlay, input, value, picks, chosen, field, next } = await render()
      await picks()[0]!.setValue(true)
      await next()
      await input('name').setValue('Groceries')
      await field('back').trigger('click')

      await picks()[2]!.setValue(true)
      expect(value('name')).toBe('Groceries')
      // Removing a payee from its chip leaves the typed name alone too.
      await overlay().find('[data-test="automation-chosen-payee"] .v-chip__close').trigger('click')
      expect(chosen()).toEqual(['Blue Bottle'])
      expect(value('name')).toBe('Groceries')
    })

    it('removes a payee from its chip and renames the automation after what is left', async () => {
      const { overlay, value, picks, chosen } = await render()
      await picks()[0]!.setValue(true)
      await picks()[2]!.setValue(true)

      await overlay().find('[data-test="automation-chosen-payee"] .v-chip__close').trigger('click')

      expect(chosen()).toEqual(['Blue Bottle'])
      expect(value('name')).toBe('Blue Bottle')
      expect(picks()[2]!.element).toHaveProperty('checked', true)
      expect(picks()[0]!.element).toHaveProperty('checked', false)
    })

    it('starts from transactions picked elsewhere, afresh at each opening', async () => {
      const { field, value, chosen, open } = await render({ seed: [wholeFoods, latte] })

      expect(chosen()).toEqual(['Whole Foods', 'Blue Bottle'])
      expect(value('name')).toBe('Whole Foods and 1 more')
      expect(field('use-amounts').text()).toBe('Use the amounts you ticked ($4.50 to $84.12)')
      expect(field('next').attributes('disabled')).toBeUndefined()

      open.value = false
      await flushPromises()
      open.value = true
      await flushPromises()
      expect(chosen()).toEqual(['Whole Foods', 'Blue Bottle'])
    })

    it('does not start an automation that is being changed from what was picked elsewhere', async () => {
      const { chosen } = await render({
        automation: makeAutomation({ payees: ['Netflix'] }),
        seed: [wholeFoods],
      })

      expect(chosen()).toEqual(['Netflix'])
    })

    it('carries on without a preview when it cannot be had', async () => {
      const { field, picks, previewApi, settle } = await render()
      previewApi.mockRejectedValue(new Error('Offline'))

      await picks()[0]!.setValue(true)
      await settle()

      expect(field('preview').text()).toBe('')
    })

    it('only shows the preview that answers the latest change', async () => {
      const { field, picks, previewApi, settle } = await render()
      const answers: ((preview: AutomationPreview) => void)[] = []
      previewApi.mockImplementation(
        () =>
          new Promise((resolve) => {
            answers.push(resolve)
          }),
      )

      await picks()[0]!.setValue(true)
      await settle()
      await picks()[2]!.setValue(true)
      await settle()
      answers[1]!({ matching: 7, overlaps: [] })
      await flushPromises()
      answers[0]!({ matching: 3, overlaps: [] })
      await flushPromises()

      expect(field('preview').text()).toBe('Matches 7 transactions you have now.')
    })

    it('ignores a preview that failed after a newer change replaced it', async () => {
      const { field, picks, previewApi, settle } = await render()
      const answers: {
        resolve: (preview: AutomationPreview) => void
        reject: (error: Error) => void
      }[] = []
      previewApi.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            answers.push({ resolve, reject })
          }),
      )

      await picks()[0]!.setValue(true)
      await settle()
      await picks()[2]!.setValue(true)
      await settle()
      answers[1]!.resolve({ matching: 2, overlaps: [] })
      await flushPromises()
      answers[0]!.reject(new Error('Too slow'))
      await flushPromises()

      expect(field('preview').text()).toBe('Matches 2 transactions you have now.')
    })

    it('has nothing to ask about once nothing is left to look for', async () => {
      const { field, picks, previewApi, settle } = await render()
      await picks()[0]!.setValue(true)
      await settle()
      expect(previewApi).toHaveBeenCalledTimes(1)

      await picks()[0]!.setValue(false)
      await settle()

      expect(previewApi).toHaveBeenCalledTimes(1)
      expect(field('preview').text()).toContain('Nothing yet.')
      expect(field('next').attributes('disabled')).toBeDefined()
    })
  })

  describe('fine-tuning what matches', () => {
    it('compares, and looks only in the account, as chosen, which the preview follows', async () => {
      const { field, picks, previewApi, select, settle } = await render()
      await picks()[0]!.setValue(true)

      select('match').vm.$emit('update:modelValue', 'contains')
      select('account').vm.$emit('update:modelValue', savings.id)
      await settle()

      expect(field('looks').text()).toBe('Contains · Rainy day fund · any amount')
      expect(field('text').text()).toContain('Contains …')
      expect(previewApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ match: 'contains', accountId: savings.id }),
      )
    })

    it('matches one amount', async () => {
      const { field, input, picks, previewApi, choose, settle } = await render()
      await picks()[0]!.setValue(true)

      await choose('Exactly')
      expect(field('amount').exists()).toBe(true)
      expect(field('amount-from').exists()).toBe(false)
      // There is no amount to match yet, so it can't go on.
      expect(field('next').attributes('disabled')).toBeDefined()

      await input('amount').setValue('9.99')
      expect(field('next').attributes('disabled')).toBeUndefined()
      expect(field('looks').text()).toBe('Exactly · any account · exactly $9.99')
      await settle()
      expect(previewApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ minAmount: '9.99', maxAmount: '9.99' }),
      )

      await choose('Any amount')
      expect(field('amount').exists()).toBe(false)
      expect(field('looks').text()).toBe('Exactly · any account · any amount')
    })

    it('matches a range of amounts, which has to be in order', async () => {
      const { field, input, picks, previewApi, choose, settle } = await render()
      await picks()[0]!.setValue(true)
      await choose('Between')
      expect(field('amount').exists()).toBe(false)
      expect(field('next').attributes('disabled')).toBeDefined()

      await input('amount-from').setValue('20')
      expect(field('looks').text()).toBe('Exactly · any account · at least $20.00')
      await input('amount-to').setValue('10')
      await flushPromises()
      expect(field('amount-from').text()).toContain("The smallest amount can't be more than")
      expect(field('amount-to').text()).toContain("The smallest amount can't be more than")
      expect(field('next').attributes('disabled')).toBeDefined()
      // It doesn't ask about amounts that can't be, and forgets the answer that went before.
      await settle()
      expect(previewApi).not.toHaveBeenCalled()
      expect(field('preview').text()).toBe('')

      await input('amount-to').setValue('30')
      await flushPromises()
      expect(field('amount-from').text()).not.toContain("can't be more than")
      expect(field('next').attributes('disabled')).toBeUndefined()
      expect(field('looks').text()).toBe('Exactly · any account · $20.00 to $30.00')
      await settle()
      expect(previewApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ minAmount: '20.00', maxAmount: '30.00' }),
      )
    })

    it('can match nothing but a largest amount', async () => {
      const { field, input, picks, choose } = await render()
      await picks()[0]!.setValue(true)
      await choose('Between')

      await input('amount-to').setValue('30')

      expect(field('looks').text()).toBe('Exactly · any account · up to $30.00')
      expect(field('next').attributes('disabled')).toBeUndefined()
    })

    it('offers the amounts of the transactions ticked, as one amount or as a range', async () => {
      const { field, picks, choose } = await render()
      expect(field('use-amounts').exists()).toBe(false)

      await picks()[0]!.setValue(true)
      expect(field('use-amounts').text()).toBe('Use the amounts you ticked ($84.12)')
      await field('use-amounts').trigger('click')
      expect(field('looks').text()).toBe('Exactly · any account · exactly $84.12')
      expect(field('amount').exists()).toBe(true)

      await picks()[2]!.setValue(true)
      expect(field('use-amounts').text()).toBe('Use the amounts you ticked ($4.50 to $84.12)')
      await field('use-amounts').trigger('click')
      expect(field('looks').text()).toBe('Exactly · any account · $4.50 to $84.12')
      expect(field('amount-from').exists()).toBe(true)

      // Unticking everything takes the offer away, and the amounts it set stay as they are.
      await picks()[0]!.setValue(false)
      await picks()[2]!.setValue(false)
      expect(field('use-amounts').exists()).toBe(false)
      await choose('Any amount')
    })
  })

  describe('what should happen', () => {
    it('goes on to it and back, saying what the automation does so far', async () => {
      const { overlay, field, picks, category, select, next, choose, input } = await render()
      await picks()[0]!.setValue(true)
      select('match').vm.$emit('update:modelValue', 'starts_with')
      select('account').vm.$emit('update:modelValue', savings.id)
      await choose('Exactly')
      await input('amount').setValue('84.12')

      await next()
      expect(overlay().text()).toContain('Say what happens to the transactions it finds')
      expect(field('next').exists()).toBe(false)
      expect(field('back').exists()).toBe(true)
      expect(field('save').text()).toBe('Add automation')
      expect(field('when').text()).toBe(
        'Payee starts with “Whole Foods”, in Rainy day fund, for exactly $84.12',
      )
      expect(field('then').text()).toBe('nothing yet')
      expect(field('action-hint').text()).toBe(
        'Choose a category, a subscription, a bill or a budget.',
      )
      expect(field('save').attributes('disabled')).toBeDefined()

      category().vm.$emit('update:modelValue', groceries.id)
      await flushPromises()
      expect(field('then').text()).toBe('put them in 🛒 Groceries')
      expect(field('action-hint').exists()).toBe(false)
      select('subscription').vm.$emit('update:modelValue', 'subscription-streamflix')
      await flushPromises()
      expect(field('then').text()).toBe('put them in 🛒 Groceries and link payments to Streamflix')

      await field('back').trigger('click')
      expect(field('next').exists()).toBe(true)
      expect(field('save').exists()).toBe(false)
      expect(overlay().text()).toContain('Tick transactions, or type what to look for.')
    })

    it('can link payments to a subscription alone', async () => {
      const { wrapper, field, picks, select, next } = await render()
      await picks()[0]!.setValue(true)
      await next()

      select('subscription').vm.$emit('update:modelValue', 'subscription-streamflix')
      await makeFormValid(wrapper)

      expect(field('then').text()).toBe('link payments to Streamflix')
      expect(field('save').attributes('disabled')).toBeUndefined()
    })

    it('can link payments to a bill, which is chosen from the same list as a subscription', async () => {
      const { wrapper, field, picks, select, next } = await render()
      await picks()[0]!.setValue(true)
      await next()

      // They're offered in a group each, so it's clear which is which.
      expect(
        select('subscription')
          .props('items')
          .map((item: { title: string }) => item.title),
      ).toEqual(['Subscriptions', 'Streamflix', 'Bills', 'City Power'])
      expect(select('subscription').props('items')[3].props.subtitle).toBe('Monthly · $96.40')
      select('subscription').vm.$emit('update:modelValue', 'bill-power')
      await makeFormValid(wrapper)

      expect(field('then').text()).toBe('link payments to City Power')
      expect(field('save').attributes('disabled')).toBeUndefined()
      expect(select('subscription').props('prependInnerIcon')).toBe(kinds.bill.icon)
    })

    it('tells the subscription it links to from one it cannot find', async () => {
      const { field, next } = await render({
        automation: makeAutomation({ subscription_id: 'subscription-gone' }),
      })
      await next()

      expect(field('then').text()).toBe(
        'put them in 🛒 Groceries and link payments to the subscription or bill',
      )
    })

    it('says which other automations already sort some of the same, without stopping the save', async () => {
      const { wrapper, overlay, field, picks, previewApi, settle, category, next } = await render({
        preview: {
          matching: 2,
          overlaps: [
            { automation_id: 'automation-a', automation_name: 'Groceries', count: 2 },
            { automation_id: 'automation-b', automation_name: 'Supermarkets', count: 1 },
          ],
        },
      })
      await picks()[0]!.setValue(true)
      category().vm.$emit('update:modelValue', groceries.id)
      await settle()
      await next()
      await makeFormValid(wrapper)

      expect(previewApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: true, subscription: false }),
      )
      expect(
        overlay()
          .findAll('[data-test="automation-overlap"]')
          .map((alert) => text(alert)),
      ).toEqual([
        'Groceries already does this for 2 of them. The older automation wins where both apply.',
        'Supermarkets already does this for 1 of them. The older automation wins where both apply.',
      ])
      expect(field('save').attributes('disabled')).toBeUndefined()
    })

    it('needs a name', async () => {
      const { wrapper, field, input, picks, category, next } = await render()
      await picks()[0]!.setValue(true)
      await next()
      category().vm.$emit('update:modelValue', groceries.id)
      await input('name').setValue('   ')
      wrapper.findComponent({ name: 'VForm' }).vm.$emit('update:modelValue', false)
      await flushPromises()

      expect(field('save').attributes('disabled')).toBeDefined()
      expect(field('name').text()).toContain('Give this automation a name')
      await input('name').setValue('x'.repeat(121))
      await flushPromises()
      expect(field('name').text()).toContain('Keep it under 120 characters')
    })
  })

  describe('saving', () => {
    it('adds an automation for what was chosen', async () => {
      const created: AutomationSaved = { ...makeAutomation(), applied: 12 }
      const create = vi.spyOn(automationsApi, 'createAutomation').mockResolvedValue(created)
      const { wrapper, field, picks, saved, open, select, category, next } = await render()
      await picks()[0]!.setValue(true)
      select('match').vm.$emit('update:modelValue', 'starts_with')
      select('account').vm.$emit('update:modelValue', checking.id)
      await next()
      category().vm.$emit('update:modelValue', groceries.id)
      select('subscription').vm.$emit('update:modelValue', 'subscription-streamflix')
      await field('apply-future').find('input').setValue(true)
      await makeFormValid(wrapper)

      await field('save').trigger('click')
      await flushPromises()

      expect(create).toHaveBeenCalledWith({
        name: 'Whole Foods',
        payees: ['Whole Foods'],
        match: 'starts_with',
        account_id: checking.id,
        min_amount: null,
        max_amount: null,
        category_id: groceries.id,
        subscription_id: 'subscription-streamflix',
        counts: [],
        apply_to: 'future',
      })
      expect(saved).toHaveBeenCalledWith(created)
      expect(open.value).toBe(false)
      expect(notices.value.at(-1)?.text).toBe('Added Streaming and sorted 12 transactions')
    })

    it('adds an automation that looks for an amount', async () => {
      const create = vi
        .spyOn(automationsApi, 'createAutomation')
        .mockResolvedValue({ ...makeAutomation(), applied: 0 })
      const { wrapper, field, picks, category, next, choose, input } = await render()
      await picks()[0]!.setValue(true)
      await choose('Between')
      await input('amount-from').setValue('80')
      await input('amount-to').setValue('90')
      await next()
      category().vm.$emit('update:modelValue', groceries.id)
      await makeFormValid(wrapper)

      await field('save').trigger('click')
      await flushPromises()

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ min_amount: '80.00', max_amount: '90.00', apply_to: 'all' }),
      )
    })

    it('says nothing about sorting when nothing was sorted, or one transaction was', async () => {
      const create = vi
        .spyOn(automationsApi, 'createAutomation')
        .mockResolvedValueOnce({ ...makeAutomation(), applied: 0 })
        .mockResolvedValueOnce({ ...makeAutomation(), applied: 1 })
      const { wrapper, field, picks, category, open, next } = await render()
      await picks()[0]!.setValue(true)
      await next()
      category().vm.$emit('update:modelValue', groceries.id)
      await makeFormValid(wrapper)

      await field('save').trigger('click')
      await flushPromises()
      expect(notices.value.at(-1)?.text).toBe('Added Streaming')

      open.value = true
      await flushPromises()
      await picks()[0]!.setValue(true)
      await next()
      category().vm.$emit('update:modelValue', groceries.id)
      await makeFormValid(wrapper)
      await field('save').trigger('click')
      await flushPromises()
      expect(create).toHaveBeenCalledTimes(2)
      expect(notices.value.at(-1)?.text).toBe('Added Streaming and sorted 1 transaction')
    })

    it('shows what the API turned down, until the form changes', async () => {
      vi.spyOn(automationsApi, 'createAutomation').mockRejectedValue(
        new ApiError(409, 'Something went wrong with that.', { code: 'conflict' }),
      )
      const { wrapper, field, input, picks, category, next } = await render()
      await picks()[0]!.setValue(true)
      await next()
      category().vm.$emit('update:modelValue', groceries.id)
      await makeFormValid(wrapper)

      await field('save').trigger('click')
      await flushPromises()
      expect(field('error').text()).toBe('Something went wrong with that.')

      await input('name').setValue('Another name')
      expect(field('error').exists()).toBe(false)
    })

    it('shows what the API turned down on the fields it was about', async () => {
      vi.spyOn(automationsApi, 'createAutomation').mockRejectedValue(
        new ApiError(422, 'Check the highlighted fields and try again.', {
          code: 'invalid',
          fields: {
            name: 'This is too long.',
            category_id: 'That category is gone.',
            subscription_id: 'That subscription is gone.',
          },
        }),
      )
      const { wrapper, field, picks, category, next } = await render()
      await picks()[0]!.setValue(true)
      await next()
      category().vm.$emit('update:modelValue', groceries.id)
      await makeFormValid(wrapper)

      await field('save').trigger('click')
      await flushPromises()

      expect(field('name').text()).toContain('This is too long.')
      expect(field('category').text()).toContain('That category is gone.')
      expect(field('subscription').text()).toContain('That subscription is gone.')
    })

    it('moves on, and saves, from the keyboard only when it is ready', async () => {
      const create = vi.spyOn(automationsApi, 'createAutomation').mockResolvedValue({
        ...makeAutomation(),
        applied: 0,
      })
      const { wrapper, overlay, field, picks, category } = await render()

      // There is nothing to look for yet.
      await overlay().find('form').trigger('submit')
      expect(field('next').exists()).toBe(true)

      await picks()[0]!.setValue(true)
      await overlay().find('form').trigger('submit')
      await flushPromises()
      expect(field('save').exists()).toBe(true)

      // There is nothing to do yet.
      await overlay().find('form').trigger('submit')
      expect(create).not.toHaveBeenCalled()

      category().vm.$emit('update:modelValue', groceries.id)
      await makeFormValid(wrapper)
      await overlay().find('form').trigger('submit')
      await flushPromises()
      expect(create).toHaveBeenCalledTimes(1)
    })
  })

  describe('changing an automation', () => {
    it('has what it does now, and saves what changed', async () => {
      const automation = makeAutomation({
        name: 'Streaming',
        payees: ['Netflix', 'Hulu'],
        match: 'contains',
        account_id: savings.id,
        min_amount: '5.00',
        max_amount: '15.00',
        category_id: groceries.id,
        subscription_id: 'subscription-paused',
        apply_to: 'future',
      })
      const update = vi
        .spyOn(automationsApi, 'updateAutomation')
        .mockResolvedValue({ ...automation, applied: 1 })
      const {
        wrapper,
        overlay,
        field,
        value,
        input,
        chosen,
        saved,
        previewApi,
        settle,
        select,
        next,
      } = await render({ automation })

      expect(overlay().find('h2').text()).toBe('Edit automation')
      expect(value('name')).toBe('Streaming')
      expect(chosen()).toEqual(['Netflix', 'Hulu'])
      expect(field('looks').text()).toBe('Contains · Rainy day fund · $5.00 to $15.00')
      expect(field('apply-future').find('input').element).toHaveProperty('checked', true)
      await settle()
      expect(previewApi).toHaveBeenCalledWith({
        payees: ['Netflix', 'Hulu'],
        match: 'contains',
        accountId: savings.id,
        minAmount: '5.00',
        maxAmount: '15.00',
        automationId: automation.id,
        category: true,
        subscription: true,
      } satisfies PreviewRequest)
      // The paused subscription it links stays chosen, and the others that are paused aren't offered.
      expect(
        select('subscription')
          .props('items')
          .map((item: { title: string }) => item.title),
      ).toEqual(['Subscriptions', 'Streamflix', 'Old gym', 'Bills', 'City Power'])
      expect(select('subscription').props('items')[1].props.subtitle).toBe('Monthly · $14.99')

      await next()
      expect(field('action-hint').exists()).toBe(false)
      expect(field('save').text()).toBe('Save changes')
      await input('name').setValue('Streaming TV')
      await makeFormValid(wrapper)
      await field('save').trigger('click')
      await flushPromises()

      expect(update).toHaveBeenCalledWith(automation.id, {
        name: 'Streaming TV',
        payees: ['Netflix', 'Hulu'],
        match: 'contains',
        account_id: savings.id,
        min_amount: '5.00',
        max_amount: '15.00',
        category_id: groceries.id,
        subscription_id: 'subscription-paused',
        counts: [],
        apply_to: 'future',
      })
      expect(saved).toHaveBeenCalled()
      expect(notices.value.at(-1)?.text).toBe('Saved Streaming and sorted 1 transaction')
    })

    it.each([
      ['one amount', '9.99', '9.99', 'Exactly · any account · exactly $9.99'],
      ['a largest amount', null, '30.00', 'Exactly · any account · up to $30.00'],
      ['a smallest amount', '30.00', null, 'Exactly · any account · at least $30.00'],
      ['any amount', null, null, 'Exactly · any account · any amount'],
    ])('shows an automation for %s as it was set', async (_name, min, max, looks) => {
      const automation = makeAutomation({ min_amount: min, max_amount: max })
      const update = vi
        .spyOn(automationsApi, 'updateAutomation')
        .mockResolvedValue({ ...automation, applied: 0 })
      const { wrapper, field, next } = await render({ automation })

      expect(field('looks').text()).toBe(looks)
      await next()
      await makeFormValid(wrapper)
      await field('save').trigger('click')
      await flushPromises()

      expect(update).toHaveBeenCalledWith(
        automation.id,
        expect.objectContaining({ min_amount: min, max_amount: max }),
      )
    })

    it('offers accounts that have no institution too', async () => {
      const cash = makeAccount({ id: 'account-cash', name: 'Cash', institution: null })
      const { select } = await render({ accounts: [cash] })

      expect(select('account').props('items')).toEqual([
        { value: 'account-cash', title: 'Cash', props: { subtitle: undefined } },
      ])
    })

    it('does not offer paused subscriptions it was not linked to, and offers a closed account it is in', async () => {
      const closed = makeAccount({
        id: 'account-old',
        name: 'Old card',
        closed_at: '2026-01-01T00:00:00Z',
      })
      const automation = makeAutomation({ account_id: closed.id })
      const { select } = await render({ automation, accounts: [checking, closed] })

      expect(
        select('subscription')
          .props('items')
          .map((item: { title: string }) => item.title),
      ).toEqual(['Subscriptions', 'Streamflix', 'Bills', 'City Power'])
      expect(
        select('account')
          .props('items')
          .map((item: { title: string }) => item.title),
      ).toEqual(['Old card', 'Everyday checking'])
    })
  })

  describe('counting toward budgets', () => {
    it('offers the budgets, and counts what it sorts toward the ones chosen', async () => {
      const create = vi
        .spyOn(automationsApi, 'createAutomation')
        .mockResolvedValue({ ...makeAutomation(), applied: 0 })
      const { wrapper, field, picks, next, budgets } = await render()
      await picks()[0]!.setValue(true)
      await next()

      expect(budgets('income').props('items')).toEqual([
        { value: 'budget-monthly', title: 'Household', props: { subtitle: 'Monthly' } },
        { value: 'budget-yearly', title: 'Year plan', props: { subtitle: 'Yearly' } },
      ])
      budgets('income').vm.$emit('update:modelValue', ['budget-monthly'])
      budgets('spending').vm.$emit('update:modelValue', ['budget-yearly'])
      await flushPromises()
      // A budget is all it takes for it to have something to do.
      expect(field('then').text()).toBe(
        'count them as income in Household and count them as spending in Year plan',
      )
      expect(field('action-hint').exists()).toBe(false)
      await makeFormValid(wrapper)
      await field('save').trigger('click')
      await flushPromises()

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          category_id: null,
          subscription_id: null,
          counts: [
            { budget_id: 'budget-monthly', kind: 'income' },
            { budget_id: 'budget-yearly', kind: 'spending' },
          ],
        }),
      )
    })

    it('counts a budget as income or as spending, never both', async () => {
      const { field, picks, next, budgets } = await render()
      await picks()[0]!.setValue(true)
      await next()

      budgets('income').vm.$emit('update:modelValue', ['budget-monthly', 'budget-yearly'])
      await flushPromises()
      budgets('spending').vm.$emit('update:modelValue', ['budget-monthly'])
      await flushPromises()
      expect(field('then').text()).toBe(
        'count them as income in Year plan and count them as spending in Household',
      )

      budgets('income').vm.$emit('update:modelValue', ['budget-monthly'])
      await flushPromises()
      expect(field('then').text()).toBe('count them as income in Household')
    })

    it('keeps what it counted toward, and names a budget that is gone only as a budget', async () => {
      const automation = makeAutomation({
        counts: [
          { budget_id: 'budget-yearly', kind: 'spending' },
          { budget_id: 'budget-monthly', kind: 'income' },
          { budget_id: 'budget-gone', kind: 'income' },
        ],
      })
      const update = vi
        .spyOn(automationsApi, 'updateAutomation')
        .mockResolvedValue({ ...automation, applied: 0 })
      const { wrapper, field, next, budgets } = await render({ automation })

      expect(budgets('income').props('modelValue')).toEqual(['budget-monthly', 'budget-gone'])
      expect(budgets('spending').props('modelValue')).toEqual(['budget-yearly'])
      await next()
      expect(field('then').text()).toBe(
        'put them in 🛒 Groceries and count them as income in Household and a budget and count them as spending in Year plan',
      )
      await makeFormValid(wrapper)
      await field('save').trigger('click')
      await flushPromises()

      expect(update).toHaveBeenCalledWith(
        automation.id,
        expect.objectContaining({
          counts: [
            { budget_id: 'budget-monthly', kind: 'income' },
            { budget_id: 'budget-gone', kind: 'income' },
            { budget_id: 'budget-yearly', kind: 'spending' },
          ],
        }),
      )
    })
  })

  describe('closing', () => {
    it('closes without saving', async () => {
      const create = vi.spyOn(automationsApi, 'createAutomation')
      const { overlay, open } = await render()

      await overlay()
        .findAll('button')
        .find((button) => button.text() === 'Cancel')!
        .trigger('click')

      expect(open.value).toBe(false)
      expect(create).not.toHaveBeenCalled()
    })

    it('closes from the dialog’s own close button', async () => {
      const { open } = await render()

      await page().find('[data-test="dialog-close"]').trigger('click')
      await flushPromises()

      expect(open.value).toBe(false)
    })
  })
})
