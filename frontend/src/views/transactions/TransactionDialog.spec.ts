import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import type { Account } from '@/api/accounts'
import { ApiError } from '@/api/client'
import * as api from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import { page, typeDate } from '@/test/dom'
import {
  checking,
  coffee,
  groceries,
  latte,
  makeAccount,
  makeTransaction,
  salary,
  savings,
  seedFinance,
  visa,
  wholeFoods,
} from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { todayIso } from '@/utils/dates'
import TransactionDialog from '@/views/transactions/TransactionDialog.vue'

const oldCash = makeAccount({
  id: 'account-cash',
  name: 'Old cash jar',
  type: 'cash',
  institution: null,
  mask: null,
  balance: '0.00',
  closed_at: '2026-01-01T00:00:00Z',
})

interface Options {
  transaction?: api.Transaction | null
  defaultAccount?: string | null
  readonly?: boolean
  accounts?: Account[]
}

async function render({ accounts = [checking, savings, visa, oldCash], ...props }: Options = {}) {
  const open = ref(false)
  const saved = vi.fn()
  const deleted = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(TransactionDialog, {
        transaction: null,
        ...props,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
        onDeleted: deleted,
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance({ accounts }),
  })
  open.value = true
  await flushPromises()
  const component = (name: string) => wrapper.findComponent({ name })
  return { open, saved, deleted, component }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const field = (name: string) => dialog().find(`[data-test="transaction-${name}"]`)
const input = (name: string) => field(name).find('input:not([type="hidden"]), textarea')
const value = (name: string) => (input(name).element as HTMLInputElement).value
const buttons = () =>
  dialog()
    .findAll('.v-card-actions button')
    .map((button) => button.text())
const hint = () => field('balance-hint')
const direction = () => field('direction').find('.v-btn--active').text()
const selectedAccount = () => field('account').find('.v-select__selection-text').text()

async function type(name: string, text: string) {
  await input(name).setValue(text)
  await flushPromises()
}

async function save() {
  await field('save').trigger('click')
  await flushPromises()
}

describe('TransactionDialog', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchPayees').mockResolvedValue([])
  })

  it('adds money going out of the first account kept by hand', async () => {
    const created = makeTransaction({ id: 'transaction-new' })
    const create = vi.spyOn(api, 'createTransaction').mockResolvedValue(created)
    const { open, saved, component } = await render()
    expect(dialog().find('h2').text()).toBe('Add a transaction')
    expect(direction()).toBe('Money out')
    expect(value('date')).not.toBe('')
    expect(selectedAccount()).toBe('Everyday checking')
    expect(field('save').attributes('disabled')).toBeDefined()
    expect(hint().exists()).toBe(false)
    expect(buttons()).toEqual(['Cancel', 'Add transaction'])

    await type('amount', '84.12')
    await type('payee', 'Whole Foods')
    component('CategoryPicker').vm.$emit('update:modelValue', groceries.id)
    await type('notes', '  Weekly shop  ')
    expect(hint().text()).toBe('Everyday checking goes from $2,450.18 to $2,366.06.')
    await save()

    expect(create).toHaveBeenCalledWith({
      account_id: checking.id,
      date: todayIso(),
      amount: '-84.12',
      payee: 'Whole Foods',
      category_id: groceries.id,
      notes: 'Weekly shop',
    })
    expect(notices.value.at(-1)?.text).toBe('Added Whole Foods')
    expect(saved).toHaveBeenCalledWith(created)
    expect(open.value).toBe(false)
  })

  it('adds money coming in to the account being looked at', async () => {
    const create = vi.spyOn(api, 'createTransaction').mockResolvedValue(salary)
    await render({ defaultAccount: savings.id })
    expect(selectedAccount()).toBe('Rainy day fund')

    await field('direction').findAll('button')[1]!.trigger('click')
    await type('amount', '2400')
    await type('payee', 'Acme Corp')
    expect(hint().text()).toBe('Rainy day fund goes from $12,500.00 to $14,900.00.')
    await save()

    expect(create.mock.calls[0]![0]).toMatchObject({
      account_id: savings.id,
      amount: '2400.00',
      category_id: null,
      notes: null,
    })
  })

  it('changes the day it happened', async () => {
    const update = vi.spyOn(api, 'updateTransaction').mockResolvedValue(wholeFoods)
    await render({ transaction: wholeFoods })
    await typeDate(input('date'), '09/12/2026')
    await flushPromises()
    await save()
    expect(update.mock.calls[0]![1]).toMatchObject({ date: '2026-09-12' })
  })

  it('keeps notes to a sensible length', async () => {
    await render({ transaction: wholeFoods })
    await type('notes', 'x'.repeat(1001))
    expect(field('notes').text()).toContain('Keep notes under 1,000 characters')
    expect(field('save').attributes('disabled')).toBeDefined()
  })

  it('closes without saving, from Cancel or its close button', async () => {
    const create = vi.spyOn(api, 'createTransaction')
    const { open } = await render()
    await dialog()
      .findAll('.v-card-actions button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)

    open.value = true
    await flushPromises()
    await dialog().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('submits with Enter once everything needed is there', async () => {
    const create = vi.spyOn(api, 'createTransaction').mockResolvedValue(wholeFoods)
    await render()
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()

    await type('amount', '5')
    await type('payee', 'Corner store')
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('edits a transaction kept by hand', async () => {
    const update = vi.spyOn(api, 'updateTransaction').mockResolvedValue(wholeFoods)
    const { saved } = await render({ transaction: wholeFoods })
    expect(dialog().find('h2').text()).toBe('Edit transaction')
    expect(direction()).toBe('Money out')
    expect(value('amount')).toBe('84.12')
    expect(value('date')).toBe('09/18/2026')
    expect(value('payee')).toBe('Whole Foods')
    expect(field('from-bank').exists()).toBe(false)
    // Nothing that moves the balance has changed yet.
    expect(hint().exists()).toBe(false)
    expect(buttons()).toEqual(['Delete', 'Cancel', 'Save changes'])

    await type('amount', '90')
    expect(hint().text()).toBe('Everyday checking goes from $2,450.18 to $2,444.30.')
    await save()

    expect(update).toHaveBeenCalledWith(wholeFoods.id, {
      payee: 'Whole Foods',
      category_id: groceries.id,
      notes: null,
      account_id: checking.id,
      date: '2026-09-18',
      amount: '-90.00',
    })
    expect(notices.value.at(-1)?.text).toBe('Saved the transaction')
    expect(saved).toHaveBeenCalledWith(wholeFoods)
  })

  it('moves a transaction to another account kept by hand', async () => {
    const { component } = await render({ transaction: wholeFoods })
    component('VSelect').vm.$emit('update:modelValue', savings.id)
    await flushPromises()
    expect(hint().text()).toBe('Rainy day fund goes from $12,500.00 to $12,415.88.')
  })

  it('shows money that came in as coming in', async () => {
    await render({ transaction: salary })
    expect(direction()).toBe('Money in')
    expect(value('amount')).toBe('2,400.00')
  })

  it('keeps what the bank owns on a transaction synced through Plaid', async () => {
    const update = vi.spyOn(api, 'updateTransaction').mockResolvedValue(latte)
    const { component } = await render({ transaction: latte })
    expect(field('from-bank').text()).toContain('The bank calls it “BLUE BOTTLE COFFEE #12”.')
    expect(field('pending').text()).toBe('Pending')
    for (const name of ['amount', 'date', 'account']) {
      expect(input(name).attributes('disabled')).toBeDefined()
    }
    expect(field('direction').find('button').attributes('disabled')).toBeDefined()
    expect(selectedAccount()).toBe('Rewards Visa')

    await type('payee', 'Blue Bottle Coffee')
    component('CategoryPicker').vm.$emit('update:modelValue', coffee.id)
    await type('notes', 'Treat')
    expect(hint().exists()).toBe(false)
    await save()

    expect(update).toHaveBeenCalledWith(latte.id, {
      payee: 'Blue Bottle Coffee',
      category_id: coffee.id,
      notes: 'Treat',
    })
  })

  it("leaves out the bank's description when there isn't one", async () => {
    await render({
      transaction: makeTransaction({ source: 'plaid', account_id: visa.id }),
    })
    expect(field('from-bank').text()).not.toContain('The bank calls it')
  })

  it('says when a transaction was imported from a file', async () => {
    await render({ transaction: makeTransaction({ source: 'file' }) })
    expect(field('from-file').text()).toBe('Imported from a file.')
    expect(field('from-bank').exists()).toBe(false)
  })

  it('lists the accounts it could go in, and the closed one it is in', async () => {
    const { component } = await render({
      transaction: makeTransaction({ account_id: oldCash.id }),
    })
    const items = component('VSelect').props('items') as {
      title: string
      props: { subtitle: string; disabled: boolean }
    }[]
    expect(items.map(({ title, props }) => [title, props.subtitle, props.disabled])).toEqual([
      ['Old cash jar', '', true],
      ['Everyday checking', 'Harbor Credit Union · •••• 4410', false],
      ['Rainy day fund', 'Harbor Credit Union', false],
    ])
  })

  it('needs an account kept by hand to add to', async () => {
    await render({ accounts: [visa] })
    expect(field('account').find('.v-select__selection-text').exists()).toBe(false)
    await type('amount', '5')
    await type('payee', 'Corner store')
    expect(hint().exists()).toBe(false)
    expect(field('save').attributes('disabled')).toBeDefined()
  })

  it('fills in the category a payee had last, unless one is chosen', async () => {
    const { component } = await render()
    const payee = component('PayeeField')
    const picker = component('CategoryPicker')

    payee.vm.$emit('picked', { payee: 'Venmo', category_id: null, count: 1 })
    await flushPromises()
    expect(picker.props('modelValue')).toBeNull()
    payee.vm.$emit('picked', { payee: 'Whole Foods', category_id: groceries.id, count: 3 })
    await flushPromises()
    expect(picker.props('modelValue')).toBe(groceries.id)
    payee.vm.$emit('picked', { payee: 'Blue Bottle', category_id: coffee.id, count: 2 })
    await flushPromises()
    expect(picker.props('modelValue')).toBe(groceries.id)
  })

  it('shows viewers the details without ways to change them', async () => {
    const update = vi.spyOn(api, 'updateTransaction')
    const { open } = await render({ transaction: wholeFoods, readonly: true })
    expect(dialog().find('h2').text()).toBe('Transaction details')
    expect(buttons()).toEqual(['Close'])
    expect(input('payee').attributes('readonly')).toBeDefined()
    await type('amount', '90')
    expect(hint().exists()).toBe(false)

    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()

    await dialog().find('.v-card-actions button').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('deletes a transaction kept by hand once confirmed', async () => {
    const remove = vi.spyOn(api, 'deleteTransaction').mockResolvedValue(undefined)
    const { open, deleted } = await render({ transaction: wholeFoods })

    await field('delete').trigger('click')
    expect(confirmRequest.value).toMatchObject({
      title: 'Delete Whole Foods?',
      text: "Everyday checking's balance moves back by its amount. This can't be undone.",
      confirmText: 'Delete transaction',
      tone: 'error',
    })
    await answer(false)
    expect(remove).not.toHaveBeenCalled()
    expect(open.value).toBe(true)

    await field('delete').trigger('click')
    await answer(true)
    expect(remove).toHaveBeenCalledWith(wholeFoods.id)
    expect(notices.value.at(-1)?.text).toBe('Deleted the transaction')
    expect(deleted).toHaveBeenCalledWith(wholeFoods)
    expect(open.value).toBe(false)
  })

  it("doesn't mention a balance when deleting what the bank synced", async () => {
    await render({ transaction: latte })
    await field('delete').trigger('click')
    expect(confirmRequest.value?.text).toBe("This can't be undone.")
  })

  it('shows what the API rejected by the field it was about', async () => {
    vi.spyOn(api, 'updateTransaction').mockRejectedValue(
      new ApiError(422, 'Check the highlighted fields.', {
        fields: { payee: 'Enter a shorter payee' },
      }),
    )
    await render({ transaction: wholeFoods })
    await save()
    expect(field('payee').text()).toContain('Enter a shorter payee')
    expect(field('error').exists()).toBe(false)
    expect(field('save').attributes('disabled')).toBeDefined()

    // Changing it lets it be sent again.
    await type('payee', 'Whole Foods Market')
    expect(field('payee').text()).not.toContain('Enter a shorter payee')
    expect(field('save').attributes('disabled')).toBeUndefined()
  })

  it('says what went wrong otherwise', async () => {
    vi.spyOn(api, 'updateTransaction').mockRejectedValue(
      new ApiError(404, 'That transaction no longer exists.'),
    )
    const { open } = await render({ transaction: wholeFoods })
    await save()
    expect(field('error').text()).toBe('That transaction no longer exists.')
    expect(open.value).toBe(true)
  })
})
