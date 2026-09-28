import { flushPromises } from '@vue/test-utils'

import type { ImportOptions, ImportPreview } from '@/api/imports'
import { useImportWizard } from '@/stores/importWizard'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import {
  harborFormat,
  makeCsvPreview,
  makeLayout,
  makeOptions,
  makePreview,
  makeRow,
  seedImports,
  seedWizard,
} from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import ColumnsStep from '@/views/import/ColumnsStep.vue'

async function render(preview: ImportPreview = makePreview()) {
  const mounted = await mountWithPlugins(ColumnsStep, {
    width: 1280,
    beforeMount: () => {
      seedFinance()
      seedImports()
      seedWizard(preview)
    },
  })
  const wizard = useImportWizard()
  const change = vi.spyOn(wizard, 'changeOptions').mockImplementation((next) => {
    wizard.options = next
  })
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const findAll = (name: string) => wrapper.findAll(`[data-test="${name}"]`)
  const component = (name: string, test: string, index = 0) =>
    wrapper.findAllComponents({ name }).filter((found) => found.attributes('data-test') === test)[
      index
    ]!
  /** What the file's columns are read as now. */
  const options = () => wizard.options as ImportOptions
  return { ...mounted, wizard, change, find, findAll, component, options }
}

describe('ColumnsStep', () => {
  it('shows what each column holds, as detected', async () => {
    const { find, findAll } = await render()
    expect(find('columns-detected').exists()).toBe(true)
    expect(find('columns-saved-format').exists()).toBe(false)
    expect(find('columns-missing').exists()).toBe(false)

    const rows = findAll('column-row')
    expect(rows.map((row) => row.find('[data-test="column-name"]').text())).toEqual([
      'Date',
      'Description',
      'Amount',
      'Balance',
      'Transaction ID',
    ])
    expect(rows[0]!.text()).toContain('09/01/2026 · 09/02/2026 · 09/03/2026')
    expect(rows[0]!.classes()).toContain('columns-list__row--used')
    expect(
      findAll('column-choice').map((choice) => choice.find('.v-select__selection-text').text()),
    ).toEqual(['Date', 'Payee or description', 'Amount', 'Balance', 'Transaction ID'])
  })

  it('says a saved format read it, and which columns are still needed', async () => {
    const { find, findAll } = await render(
      makePreview({
        profile_id: harborFormat.id,
        csv: makeCsvPreview({
          columns: [
            { index: 0, name: 'Posted', samples: [] },
            { index: 1, name: 'Details', samples: ['COFFEE'] },
          ],
          missing: ['date', 'amount'],
        }),
        options: makeOptions({
          csv: makeLayout({
            columns: { ...makeLayout().columns, date: null, amount: null, payee: 1, balance: null },
          }),
        }),
        rows: [],
        summary: { ...makePreview().summary, rows: 0, invalid: 3 },
      }),
    )
    expect(find('columns-saved-format').text()).toBe(
      'Read with your saved format, Harbor Credit Union checking. Anything you change here updates it when you import.',
    )
    expect(find('columns-detected').exists()).toBe(false)
    expect(find('columns-missing').text()).toBe(
      'Choose the column with each transaction’s date and amount.',
    )
    const rows = findAll('column-row')
    expect(rows[0]!.text()).toContain('Empty')
    expect(rows[0]!.classes()).not.toContain('columns-list__row--used')
    expect(find('columns-count').text()).toBe('0 transactions')
    expect(find('columns-no-rows').text()).toBe(
      'Rows show up here once the date and amount columns are chosen.',
    )
  })

  it('reads the file again when a column is matched to something else', async () => {
    const { findAll, change, options } = await render()
    await findAll('column-choice')[3]!.find('.v-field').trigger('mousedown')
    await flushPromises()
    const items = page().findAll('.v-menu.v-overlay--active .v-list-item')
    expect(items.map((item) => item.text())).toContain('AmountOne column for money in and out')
    await items.find((item) => item.text() === 'Memo or notes')!.trigger('click')
    await flushPromises()

    expect(change).toHaveBeenCalledOnce()
    expect(options().csv?.columns).toMatchObject({ memo: 3, balance: null })
  })

  it('leaves out a column that isn’t imported', async () => {
    const { component, options } = await render()
    component('VSelect', 'column-choice', 4).vm.$emit('update:modelValue', 'skip')
    await flushPromises()
    expect(options().csv?.columns.id).toBeNull()
  })

  it('changes how dates and amounts are written', async () => {
    const { component, find, options } = await render()
    component('VSelect', 'columns-date-order').vm.$emit('update:modelValue', 'dmy')
    component('VSelect', 'columns-decimal-mark').vm.$emit('update:modelValue', ',')
    await flushPromises()
    await find('columns-flip').find('input').setValue(true)
    await flushPromises()
    expect(options()).toMatchObject({ date_order: 'dmy', decimal_mark: ',', flip: true })
    expect(find('columns-direction').exists()).toBe(false)
  })

  it('asks which of the direction column’s values mean money in', async () => {
    const layout = makeLayout({
      columns: { ...makeLayout().columns, direction: 3, balance: null },
      amounts: 'direction',
      money_in_values: ['credit'],
    })
    const { find, findAll, options } = await render(
      makePreview({
        options: makeOptions({ csv: layout }),
        csv: makeCsvPreview({ direction_values: ['Credit', 'Debit'] }),
      }),
    )
    expect(find('columns-flip').exists()).toBe(false)
    const values = findAll('columns-direction-value')
    expect(values.map((value) => value.text())).toEqual(['Credit', 'Debit'])
    expect(values[0]!.classes()).toContain('text-primary')
    expect(values[1]!.classes()).not.toContain('text-primary')

    await values[1]!.trigger('click')
    await flushPromises()
    expect(options().csv?.money_in_values).toEqual(['Credit', 'Debit'])
  })

  it('has no money-in question when amounts come in two columns', async () => {
    const { find } = await render(
      makePreview({
        options: makeOptions({
          csv: makeLayout({
            columns: { ...makeLayout().columns, amount: null, money_in: 2, money_out: 3 },
            amounts: 'split',
          }),
        }),
      }),
    )
    expect(find('columns-flip').exists()).toBe(false)
    expect(find('columns-direction').exists()).toBe(false)
  })

  it('shows the file’s lines when the transactions don’t start at the top', async () => {
    const lines = [
      ['Harbor Credit Union'],
      ['Account 4410'],
      ['Date', 'Amount'],
      ['09/01/2026', '1875.00'],
    ]
    const { find, component, options } = await render(
      makePreview({
        options: makeOptions({ csv: makeLayout({ skip_rows: 2 }) }),
        csv: makeCsvPreview({ lines }),
      }),
    )
    const layout = find('columns-layout')
    expect(layout.find('.v-expansion-panel--active').exists()).toBe(true)
    const rows = find('columns-lines').findAll('tr')
    expect(rows.map((row) => row.classes())).toEqual([
      ['file-lines__line--skipped'],
      ['file-lines__line--skipped'],
      ['file-lines__line--header'],
      [],
    ])
    expect(rows[2]!.text()).toBe('3DateAmount')

    component('VSelect', 'columns-delimiter').vm.$emit('update:modelValue', ';')
    expect(options().csv?.delimiter).toBe(';')
    const skip = component('VNumberInput', 'columns-skip-rows')
    for (const [value, skipped] of [
      [3.6, 4],
      [250, 100],
      [-3, 0],
      [null, 0],
    ] as const) {
      skip.vm.$emit('update:modelValue', value)
      expect(options().csv?.skip_rows).toBe(skipped)
    }
    await find('columns-header').find('input').setValue(false)
    await flushPromises()
    expect(options().csv?.header).toBe(false)
  })

  it('shows a file without column names from its first line', async () => {
    const { find } = await render(
      makePreview({
        options: makeOptions({ csv: makeLayout({ header: false }) }),
        csv: makeCsvPreview({ lines: [['09/01/2026', '1875.00']] }),
      }),
    )
    expect(find('columns-layout').find('.v-expansion-panel--active').exists()).toBe(true)
    expect(find('columns-lines').find('tr').classes()).toEqual([])
  })

  it('keeps the file’s lines out of the way when it starts with its column names', async () => {
    const { find } = await render()
    const layout = find('columns-layout')
    expect(layout.find('.v-expansion-panel--active').exists()).toBe(false)
    await layout.find('.v-expansion-panel-title').trigger('click')
    await flushPromises()
    expect(layout.find('.v-expansion-panel--active').exists()).toBe(true)
    expect(find('columns-lines').findAll('tr')[0]!.classes()).toEqual(['file-lines__line--header'])
  })

  it('shows how the first rows read, and how many can’t be', async () => {
    const rows = [
      makeRow(),
      makeRow({ line: 3, payee: null, description: 'ACH DEPOSIT' }),
      makeRow({
        line: 4,
        date: null,
        amount: null,
        payee: null,
        description: null,
        status: 'invalid',
        problem: 'It has no date or amount.',
      }),
      ...[5, 6, 7, 8].map((line) => makeRow({ line })),
    ]
    const { find, findAll } = await render(
      makePreview({
        rows,
        summary: { ...makePreview().summary, rows: 7, invalid: 1 },
      }),
    )
    expect(find('columns-count').text()).toBe('7 transactions · 1 row can’t be read')
    const shown = findAll('columns-row')
    expect(shown).toHaveLength(6)
    expect(shown[0]!.text()).toBe('Sep 1NORTHWIND HEALTH PAYROLL PPD+$1,875.00')
    expect(shown[1]!.text()).toContain('ACH DEPOSIT')
    expect(shown[2]!.text()).toBe('—It has no date or amount.')
    expect(find('columns-no-rows').exists()).toBe(false)
  })

  it('counts the rows that can’t be read', async () => {
    const { find } = await render(
      makePreview({ account_id: null, summary: { ...makePreview().summary, invalid: 1204 } }),
    )
    expect(find('columns-count').text()).toBe('4 transactions · 1,204 rows can’t be read')
    expect(find('columns-rows').text()).toContain('+$1,875.00')
  })
})
