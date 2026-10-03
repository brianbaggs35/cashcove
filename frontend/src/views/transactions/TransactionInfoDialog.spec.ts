import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import type { Transaction } from '@/api/transactions'
import * as api from '@/api/transactions'
import { ApiError } from '@/api/client'
import { page } from '@/test/dom'
import { coffee, groceries, latte, makeTransaction, seedFinance, wholeFoods } from '@/test/finance'
import { checkingImport, seedImports } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import TransactionInfoDialog from '@/views/transactions/TransactionInfoDialog.vue'

const describedTransaction = { ...wholeFoods, original_description: 'WHOLE FOODS MARKET' }

async function render(editable = true, transaction: Transaction = describedTransaction) {
  const open = ref(false)
  const saved = vi.fn()
  const edited = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(TransactionInfoDialog, {
        transaction,
        editable,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
        onEdit: edited,
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => {
      seedFinance()
      seedImports()
    },
  })
  open.value = true
  await flushPromises()
  return { open, saved, edited, wrapper }
}

const dialog = () => document.querySelector('.v-overlay--active .app-dialog')!

describe('TransactionInfoDialog', () => {
  it('shows the transaction details and opens its separate edit form', async () => {
    const { edited, open, wrapper } = await render()
    expect(dialog().textContent).toContain('Whole Foods')
    expect(dialog().textContent).toContain('Everyday checking')
    expect(dialog().textContent).toContain('Original description')
    expect(wrapper.findComponent({ name: 'CategoryPicker' }).exists()).toBe(true)

    await page().find('[data-test="transaction-info-edit"]').trigger('click')
    expect(edited).toHaveBeenCalledWith(describedTransaction)
    wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('saves a quick category change and reflects the saved transaction', async () => {
    const update = vi.spyOn(api, 'updateTransaction').mockResolvedValue({
      ...wholeFoods,
      category_id: coffee.id,
    })
    const { saved, wrapper } = await render()
    wrapper.findComponent({ name: 'CategoryPicker' }).vm.$emit('update:modelValue', coffee.id)
    await flushPromises()

    expect(update).toHaveBeenCalledWith(describedTransaction.id, { category_id: coffee.id })
    expect(saved).toHaveBeenCalledWith({ ...wholeFoods, category_id: coffee.id })
  })

  it('shows viewers details without category editing or an edit action', async () => {
    const update = vi.spyOn(api, 'updateTransaction')
    const { open, wrapper } = await render(false, wholeFoods)
    expect(wrapper.findComponent({ name: 'CategoryPicker' }).exists()).toBe(false)
    expect(page().find('[data-test="transaction-info-edit"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'CategoryChip' }).props('categoryId')).toBe(groceries.id)
    expect(update).not.toHaveBeenCalled()

    await page().find('.v-card-actions button').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('shows bank source, pending status, and notes, even if its account was removed', async () => {
    const bankTransaction = {
      ...latte,
      account_id: 'account-deleted',
      original_description: latte.payee,
      notes: 'Morning coffee',
    }
    await render(true, bankTransaction)
    expect(dialog().textContent).toContain('From a bank through Plaid')
    expect(dialog().textContent).toContain('Pending')
    expect(dialog().textContent).toContain('Morning coffee')
    expect(dialog().textContent).not.toContain('Original description')
    expect(dialog().textContent).toContain('Deleted account')
  })

  it('shows a synced bank source and a matching original description only once', async () => {
    await render(true, { ...latte, original_description: latte.payee })
    expect(dialog().textContent).toContain('Synced from the bank through Plaid')
    expect(dialog().textContent).not.toContain('Original description')
  })

  it('shows the imported file and its original description', async () => {
    await render(
      true,
      makeTransaction({
        source: 'file',
        import_id: checkingImport.id,
        original_description: 'WHOLEFDS MKT #10234',
      }),
    )
    expect(dialog().textContent).toContain('Imported from a file')
    expect(dialog().textContent).toContain('harbor-checking.csv')
    expect(dialog().textContent).toContain('WHOLEFDS MKT #10234')
  })

  it('does not send an unchanged category and shows category update errors', async () => {
    const update = vi
      .spyOn(api, 'updateTransaction')
      .mockRejectedValue(new ApiError(422, 'Could not save the category.'))
    const { wrapper } = await render()
    const picker = wrapper.findComponent({ name: 'CategoryPicker' })
    picker.vm.$emit('update:modelValue', groceries.id)
    await flushPromises()
    expect(update).not.toHaveBeenCalled()

    picker.vm.$emit('update:modelValue', coffee.id)
    await flushPromises()
    expect(update).toHaveBeenCalledWith(describedTransaction.id, { category_id: coffee.id })
    expect(page().find('[data-test="transaction-info-error"]').text()).toContain(
      'Could not save the category.',
    )
  })

  it('ignores additional category changes while one is saving', async () => {
    let resolveUpdate!: (transaction: Transaction) => void
    const update = vi.spyOn(api, 'updateTransaction').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
    )
    const { wrapper } = await render()
    const picker = wrapper.findComponent({ name: 'CategoryPicker' })
    picker.vm.$emit('update:modelValue', coffee.id)
    await flushPromises()
    picker.vm.$emit('update:modelValue', null)
    expect(update).toHaveBeenCalledTimes(1)

    resolveUpdate({ ...wholeFoods, category_id: coffee.id })
    await flushPromises()
  })
})
