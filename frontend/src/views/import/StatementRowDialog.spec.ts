import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import type { StatementRow } from '@/api/ai'
import { useImportWizard } from '@/stores/importWizard'
import { makeStatementRow } from '@/test/ai'
import { page, typeDate } from '@/test/dom'
import { checking, seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import StatementRowDialog from '@/views/import/StatementRowDialog.vue'

async function render(row: StatementRow | null = makeStatementRow()) {
  const open = ref(false)
  const Host = defineComponent({
    render: () =>
      h(StatementRowDialog, {
        row,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  const wizard = useImportWizard()
  wizard.accountId = checking.id
  const edit = vi.spyOn(wizard, 'editRow').mockImplementation(() => undefined)
  open.value = true
  await flushPromises()
  return { wrapper, open, edit }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const field = (name: string) => dialog().find(`[data-test="statement-row-${name}"]`)
const input = (name: string) => field(name).find('input')
const value = (name: string) => (input(name).element as HTMLInputElement).value
const direction = () => field('direction').find('.v-btn--active').text()
const save = () => field('save')

async function type(name: string, text: string) {
  await input(name).setValue(text)
  await flushPromises()
}

async function pickDirection(label: string) {
  const button = field('direction')
    .findAll('button')
    .find((candidate) => candidate.text() === label)
  await button?.trigger('click')
  await flushPromises()
}

describe('StatementRowDialog', () => {
  it('shows what the AI read, and why it should be checked', async () => {
    await render(makeStatementRow({ note: 'The date is outside the statement’s dates.' }))

    expect(dialog().text()).toContain('Check this transaction')
    expect(field('note').text()).toBe('The date is outside the statement’s dates.')
    expect(direction()).toBe('Money out')
    expect(value('amount')).toBe('84.12')
    expect(value('date')).toBe('09/02/2026')
    expect(value('payee')).toBe('Wholefds Mkt Austin Tx')
    expect(save().attributes('disabled')).toBeUndefined()
  })

  it('has no note when there is nothing to check', async () => {
    await render()

    expect(field('note').exists()).toBe(false)
  })

  it('takes what was corrected, with money out as a negative amount', async () => {
    const { open, edit } = await render()

    await type('payee', '  Whole Foods  ')
    await type('amount', '90')
    await typeDate(input('date'), '09/03/2026')
    await save().trigger('click')
    await flushPromises()

    expect(edit).toHaveBeenCalledWith(1, {
      date: '2026-09-03',
      payee: 'Whole Foods',
      amount: '-90.00',
    })
    expect(open.value).toBe(false)
  })

  it('takes money in as a positive amount', async () => {
    const { edit } = await render(makeStatementRow({ line: 2, amount: '2400.00' }))

    expect(direction()).toBe('Money in')
    expect(value('amount')).toBe('2,400.00')

    await save().trigger('click')
    await flushPromises()

    expect(edit).toHaveBeenCalledWith(2, expect.objectContaining({ amount: '2400.00' }))
  })

  it('can be sent the other way', async () => {
    const { edit } = await render()

    await pickDirection('Money in')
    await save().trigger('click')
    await flushPromises()

    expect(edit).toHaveBeenCalledWith(1, expect.objectContaining({ amount: '84.12' }))
  })

  it('can have money in turned to money out', async () => {
    const { edit } = await render(makeStatementRow({ line: 2, amount: '2400.00' }))

    await pickDirection('Money out')
    await save().trigger('click')
    await flushPromises()

    expect(edit).toHaveBeenCalledWith(2, expect.objectContaining({ amount: '-2400.00' }))
  })

  it('can’t be saved until what the AI couldn’t read is filled in', async () => {
    const { edit } = await render(makeStatementRow({ date: null, amount: null, payee: '' }))

    expect(value('amount')).toBe('')
    expect(value('date')).toBe('')
    expect(direction()).toBe('Money out')
    await flushPromises()
    expect(save().attributes('disabled')).toBeDefined()
    await save().trigger('click')
    expect(edit).not.toHaveBeenCalled()

    await type('payee', 'A shop')
    await type('amount', '12.50')
    await typeDate(input('date'), '09/04/2026')
    await flushPromises()

    expect(save().attributes('disabled')).toBeUndefined()
    await save().trigger('click')
    expect(edit).toHaveBeenCalledWith(1, { date: '2026-09-04', payee: 'A shop', amount: '-12.50' })
  })

  it('says who it was with has to be filled in', async () => {
    await render()

    await type('payee', '   ')

    expect(field('payee').text()).toContain('Enter who it was with')
    expect(save().attributes('disabled')).toBeDefined()
  })

  it('changes nothing when cancelled, and starts from the row again when opened again', async () => {
    const { open, edit } = await render()
    await type('payee', 'Something else')

    await field('cancel').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(edit).not.toHaveBeenCalled()

    open.value = true
    await flushPromises()
    expect(value('payee')).toBe('Wholefds Mkt Austin Tx')
  })

  it('closes from its own close button as well, changing nothing', async () => {
    const { open, edit } = await render()
    await type('payee', 'Something else')

    await dialog().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
    expect(edit).not.toHaveBeenCalled()
  })

  it('does nothing with no row to correct', async () => {
    const { open, edit } = await render(null)
    await type('payee', 'A shop')
    await type('amount', '12.50')
    await typeDate(input('date'), '09/04/2026')
    await flushPromises()

    await save().trigger('click')

    expect(edit).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
  })
})
