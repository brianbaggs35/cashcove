import { flushPromises } from '@vue/test-utils'

import type { ImportPreview } from '@/api/imports'
import { useImportWizard } from '@/stores/importWizard'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { makeStatementRow } from '@/test/ai'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import {
  coffeeRow,
  groceriesRow,
  makePreview,
  makeRow,
  payroll,
  pendingRow,
  seedWizard,
} from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import { makeBill } from '@/test/subscriptions'
import ReviewRows from '@/views/import/ReviewRows.vue'

async function render(preview: ImportPreview = makePreview(), seed: () => void = () => {}) {
  const mounted = await mountWithPlugins(ReviewRows, {
    width: 1280,
    beforeMount: () => {
      seedFinance()
      seedWizard(preview, 'review')
      seed()
    },
  })
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const rows = () => wrapper.findAll('[data-test="review-row"]')
  const chooseAll = () => find('review-choose-all')
  const ticked = () => find('review-rows-head').text().replace(/\s+/g, ' ')
  async function click(name: string) {
    await find(name).trigger('click')
    await flushPromises()
  }
  return { ...mounted, wizard: useImportWizard(), find, rows, chooseAll, ticked, click }
}

/** Rows for a month of a busy card: every one new. */
const many = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    makeRow({ line: index + 2, payee: `Shop ${index + 1}`, description: `SHOP ${index + 1}` }),
  )

describe('ReviewRows', () => {
  it('says which rows automations will sort, and the bill or subscription they link', async () => {
    const { rows } = await render(
      makePreview({
        rows: [
          makeRow({
            category_id: 'category-paycheck',
            automation: { category_id: 'category-paycheck', subscription_id: null },
          }),
          makeRow({
            line: 3,
            amount: '-96.40',
            payee: 'City Power',
            category_id: 'category-groceries',
            automation: { category_id: 'category-groceries', subscription_id: 'bill-power' },
          }),
          makeRow({
            line: 4,
            amount: '-9.99',
            payee: 'Old gym',
            automation: { category_id: null, subscription_id: 'subscription-gone' },
          }),
          makeRow({ line: 5, amount: '-4.50', payee: 'Corner Cafe' }),
        ],
      }),
      () => {
        useSubscriptionsStore().bills = [makeBill()]
      },
    )

    const notes = rows().map((row) => row.find('[data-test="review-row-automation"]'))
    expect(notes[0]!.text()).toBe('Sorted by your automations')
    expect(notes[1]!.text()).toBe('Sorted by your automations · linked to City Power')
    expect(notes[2]!.text()).toBe('Sorted by your automations · linked to a subscription or bill')
    expect(notes[3]!.exists()).toBe(false)
    // The category an automation gives is the one the row shows.
    expect(rows()[0]!.find('[data-test="category-chip"]').text()).toContain('Paycheck')
  })

  it('shows each row, and whether the account has it already', async () => {
    const { find, rows, ticked } = await render()
    expect(
      find('review-filters')
        .findAll('.v-chip')
        .map((chip) => chip.text().replace(/\s+/g, ' ')),
    ).toEqual(['All 4', 'New 1', 'Possible duplicates 1', 'Already there 1', 'Can’t be read 1'])
    const [paid, groceries, coffee, pending] = rows()
    expect(paid!.element.tagName).toBe('LABEL')
    expect(paid!.classes()).toContain('review-rows__row--chosen')
    expect(paid!.text()).toBe('Sep 1NORTHWIND HEALTH PAYROLL PPD+$1,875.00')

    expect(groceries!.element.tagName).toBe('DIV')
    expect(groceries!.find('[data-test="review-row-check"]').exists()).toBe(false)
    expect(groceries!.text()).toContain('Groceries')
    expect(groceries!.find('[data-test="review-row-note"]').text()).toBe(
      'Already in Everyday checking',
    )

    expect(coffee!.classes()).not.toContain('review-rows__row--chosen')
    expect(coffee!.find('[data-test="review-row-note"]').text()).toBe(
      'Possible duplicate: Blue Bottle on Sep 4, from the bank',
    )

    expect(pending!.text()).toContain('Line 5')
    expect(pending!.text()).toContain('PENDING - AMAZON MKTP US')
    expect(pending!.find('[data-test="review-row-note"]').text()).toBe('It has no date.')
    expect(ticked()).toBe('1 of 2 ticked')
    expect(find('review-more').exists()).toBe(false)
  })

  it('ticks rows one at a time, or every one shown', async () => {
    const { wizard, rows, chooseAll, ticked } = await render()
    expect(chooseAll().find('input').attributes('aria-label')).toBe('Tick every row shown')
    expect(chooseAll().classes()).toContain('v-selection-control--indeterminate')

    await rows()[2]!.find('input').setValue(true)
    await flushPromises()
    expect(wizard.selected).toEqual([payroll.line, coffeeRow.line])
    expect(ticked()).toBe('2 of 2 ticked')
    expect(chooseAll().find('input').attributes('aria-label')).toBe('Untick every row shown')

    await chooseAll().find('input').setValue(false)
    await flushPromises()
    expect(wizard.selected).toEqual([])
    expect(ticked()).toBe('0 of 2 ticked')

    await chooseAll().find('input').setValue(true)
    await flushPromises()
    expect(wizard.selected).toEqual([payroll.line, coffeeRow.line])

    await rows()[0]!.find('input').setValue(false)
    await flushPromises()
    expect(wizard.selected).toEqual([coffeeRow.line])
  })

  it('shows the rows of one kind', async () => {
    const { wizard, rows, click, ticked, chooseAll } = await render()
    await click('review-filter-possible_duplicate')
    expect(rows()).toHaveLength(1)
    expect(ticked()).toBe('0 of 1 ticked')
    await chooseAll().find('input').setValue(true)
    await flushPromises()
    expect(wizard.selected).toEqual([payroll.line, coffeeRow.line])

    await click('review-filter-duplicate')
    expect(rows().map((row) => row.text())).toEqual([expect.stringContaining('Whole Foods')])
    expect(ticked()).toBe('0 of 0 ticked')
    expect(chooseAll().find('input').attributes('disabled')).toBeDefined()
  })

  it('shows every row again when a new reading has none of the kind shown', async () => {
    const { wizard, find, rows, click } = await render()
    await click('review-filter-invalid')
    expect(rows()).toHaveLength(1)

    wizard.preview = makePreview({ rows: [payroll, pendingRow] })
    await flushPromises()
    expect(find('review-filter-invalid').classes()).toContain('text-primary')
    expect(rows()).toHaveLength(1)

    wizard.preview = makePreview({ rows: [payroll, groceriesRow] })
    await flushPromises()
    expect(find('review-filter-invalid').exists()).toBe(false)
    expect(find('review-filter-all').classes()).toContain('text-primary')
    expect(rows()).toHaveLength(2)
  })

  it('shows a long file a page at a time', async () => {
    const { find, rows, click } = await render(makePreview({ rows: [...many(120), pendingRow] }))
    expect(rows()).toHaveLength(50)
    expect(find('review-more').text()).toBe('Show 50 more')
    await click('review-more')
    expect(rows()).toHaveLength(100)
    expect(find('review-more').text()).toBe('Show 21 more')
    await click('review-more')
    expect(rows()).toHaveLength(121)
    expect(find('review-more').exists()).toBe(false)

    await click('review-filter-new')
    expect(rows()).toHaveLength(50)
    await click('review-filter-all')
    expect(rows()).toHaveLength(50)
  })

  it('says what else it knows about a row', async () => {
    const { rows } = await render(
      makePreview({
        account_id: null,
        bank_history: { start: '2026-09-10', end: null },
        rows: [
          makeRow({ payee: 'Northwind Health' }),
          makeRow({ line: 3, date: '2026-09-12' }),
          makeRow({ line: 4, status: 'possible_duplicate' }),
          makeRow({ line: 5, payee: null, description: null, amount: null, status: 'invalid' }),
        ],
      }),
    )
    const notes = rows().map((row) => row.find('[data-test="review-row-note"]'))
    expect(notes[0]!.text()).toBe('NORTHWIND HEALTH PAYROLL PPD')
    expect(notes[1]!.text()).toBe('On a day the bank already shared through Plaid')
    expect(notes[2]!.text()).toBe('Possible duplicate in the account')
    expect(notes[3]!.exists()).toBe(false)
    expect(rows()[3]!.text()).toBe('Sep 1Unknown payee')
    expect(rows()[1]!.text()).toContain('+$1,875.00')
  })
})

describe('ReviewRows with a statement the AI read', () => {
  /** What the AI read: two rows, and a third with no date that it noted. */
  const read = [
    makeStatementRow(),
    makeStatementRow({ line: 2, payee: 'Acme Corp Payroll', amount: '2400.00' }),
    makeStatementRow({ line: 3, date: null, note: 'The AI didn’t give a date for this one.' }),
  ]
  const preview = () =>
    makePreview({
      format: 'pdf',
      rows: [
        makeRow({ line: 1, payee: 'Wholefds Mkt Austin Tx', amount: '-84.12' }),
        makeRow({ line: 2, payee: 'Acme Corp Payroll', amount: '2400.00' }),
        makeRow({
          line: 3,
          date: null,
          payee: null,
          description: 'Zelle',
          status: 'invalid',
          problem: 'It has no date.',
        }),
      ],
    })
  const statement =
    (rows = read) =>
    () => {
      const wizard = useImportWizard()
      wizard.source = 'statement'
      wizard.statementRows = rows
    }

  it('has a pencil on every row, the ones that can’t be imported too', async () => {
    const { rows } = await render(preview(), statement())

    expect(rows().map((row) => row.find('[data-test="review-row-edit"]').exists())).toEqual([
      true,
      true,
      true,
    ])
    expect(rows()[0]!.find('[data-test="review-row-edit"]').attributes('aria-label')).toBe(
      'Edit Wholefds Mkt Austin Tx',
    )
  })

  it('has no pencil for a file Cashcove read itself', async () => {
    const { rows } = await render()

    expect(rows().some((row) => row.find('[data-test="review-row-edit"]').exists())).toBe(false)
  })

  it('says what the AI wasn’t sure of beside the row, and lists those rows to look at', async () => {
    const { rows, find, click, wizard } = await render(preview(), statement())

    expect(rows()[2]!.find('[data-test="review-row-flag"]').text()).toBe(
      'The AI didn’t give a date for this one.',
    )
    expect(rows()[0]!.find('[data-test="review-row-flag"]').exists()).toBe(false)
    expect(find('review-filter-check').text()).toContain('Needs a look')
    expect(find('review-filter-check').text()).toContain('1')

    await click('review-filter-check')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.text()).toContain('Line 3')

    // Once it's corrected there's nothing left to look at, and all the rows show again.
    wizard.statementRows = read.map((row) => ({ ...row, note: null }))
    await flushPromises()
    expect(find('review-filter-check').exists()).toBe(false)
    expect(rows()).toHaveLength(3)
  })

  it('opens the row to correct, without ticking or unticking it', async () => {
    const { rows, wizard } = await render(preview(), statement())
    const ticked = [...wizard.selected]

    await rows()[0]!.find('[data-test="review-row-edit"]').trigger('click')
    await flushPromises()

    const payee = page().find('[data-test="statement-row-payee"] input')
    expect((payee.element as HTMLInputElement).value).toBe('Wholefds Mkt Austin Tx')
    expect(wizard.selected).toEqual(ticked)

    // Cancelling puts it away again.
    await page().find('[data-test="statement-row-cancel"]').trigger('click')
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="statement-row-payee"]').exists()).toBe(false)
  })

  it('opens nothing to correct for a row it has no record of', async () => {
    const { rows } = await render(preview(), statement([read[0]!]))

    await rows()[1]!.find('[data-test="review-row-edit"]').trigger('click')
    await flushPromises()

    const payee = page().find('[data-test="statement-row-payee"] input')
    expect((payee.element as HTMLInputElement).value).toBe('')
  })
})
