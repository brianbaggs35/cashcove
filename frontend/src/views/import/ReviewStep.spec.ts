import { flushPromises } from '@vue/test-utils'
import type { MockInstance } from 'vitest'

import type { ImportPreview } from '@/api/imports'
import { page } from '@/test/dom'
import { checking, makeAccount, savings, seedFinance, visa } from '@/test/finance'
import {
  harborFormat,
  makeOptions,
  makePreview,
  makeRow,
  seedImports,
  seedWizard,
} from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import { formatDateRange } from '@/utils/dates'
import ReviewStep from '@/views/import/ReviewStep.vue'

const linkedChecking = makeAccount({
  id: 'account-linked',
  name: 'Tartan checking',
  institution: 'Tartan Bank',
  mask: '0042',
  balance: '980.00',
  source: 'plaid',
  connection_id: 'connection-tartan',
})

const qfx = makePreview({
  format: 'ofx',
  file_name: 'harbor.qfx',
  options: makeOptions({ csv: null }),
  csv: null,
  statements: [
    {
      index: 0,
      name: null,
      institution: 'Harbor Credit Union',
      type: 'checking',
      mask: '4410',
      currency: 'USD',
      count: 4,
    },
    {
      index: 1,
      name: 'Rainy day fund',
      institution: 'Harbor Credit Union',
      type: 'savings',
      mask: null,
      currency: 'USD',
      count: 1,
    },
    { index: 2, name: null, institution: null, type: null, mask: null, currency: null, count: 0 },
  ],
})

async function render(
  preview: ImportPreview = makePreview(),
  setUp: (wizard: ReturnType<typeof seedWizard>) => void = () => undefined,
) {
  let wizard!: ReturnType<typeof seedWizard>
  // The step's template takes these when it first renders.
  let chooseAccount!: MockInstance<(id: string) => void>
  let chooseStatement!: MockInstance<(index: number) => void>
  const mounted = await mountWithPlugins(ReviewStep, {
    width: 1280,
    beforeMount: () => {
      seedFinance({ accounts: [checking, savings, visa, linkedChecking] })
      seedImports()
      wizard = seedWizard(preview, 'review')
      chooseAccount = vi.spyOn(wizard, 'chooseAccount').mockImplementation((id) => {
        wizard.accountId = id
      })
      chooseStatement = vi.spyOn(wizard, 'chooseStatement').mockImplementation(() => undefined)
      setUp(wizard)
    },
  })
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, wizard, find, chooseAccount, chooseStatement }
}

describe('ReviewStep', () => {
  it('describes the file, and imports into the account it matched', async () => {
    const { wrapper, wizard, find } = await render()
    expect(find('review-file').text()).toContain('harbor-checking.csv')
    expect(find('review-file').text()).toContain(
      `CSV · 4 transactions · ${formatDateRange({ start: '2026-09-01', end: '2026-09-03' })}`,
    )
    expect(find('review-saved-format').exists()).toBe(false)
    expect(find('review-statement').exists()).toBe(false)
    expect(find('review-account').find('.v-field').text()).toContain('Everyday checking')
    expect(find('review-bank-history').exists()).toBe(false)
    expect(find('review-rows').exists()).toBe(true)
    expect(find('balance-choice').exists()).toBe(true)
    expect(find('review-bank-balance').exists()).toBe(false)

    expect(find('review-save-toggle').text()).toBe(
      'Save how this file is read, for the bank’s next files',
    )
    const name = find('review-format-name').find('input')
    expect((name.element as HTMLInputElement).value).toBe('Harbor Credit Union checking 2')
    await name.setValue('Harbor everyday')
    expect(wizard.formatName).toBe('Harbor everyday')

    await find('review-save-toggle').find('input').setValue(false)
    await flushPromises()
    expect(wizard.save).toBe(false)
    expect(find('review-format-name').exists()).toBe(false)

    await find('review-new-account').trigger('click')
    expect(wrapper.emitted('add-account')).toHaveLength(1)
  })

  it('lists the accounts it could go in', async () => {
    const { find, chooseAccount } = await render()
    await find('review-account').find('.v-field').trigger('mousedown')
    await flushPromises()
    const items = page().findAll('.v-menu.v-overlay--active .v-list-item')
    expect(items.map((item) => item.find('.v-list-item-subtitle').text())).toEqual([
      'Harbor Credit Union · •••• 4410 · Checking',
      'Harbor Credit Union · Savings',
      'Tartan Bank · •••• 3333 · Linked through Plaid',
      'Tartan Bank · •••• 0042 · Linked through Plaid',
    ])
    await items[1]!.trigger('click')
    await flushPromises()
    expect(chooseAccount).toHaveBeenCalledWith(savings.id)
    expect(find('review-account').find('.v-field').text()).toContain('Rainy day fund')
  })

  it('asks which account the file is from when it can’t tell', async () => {
    const { find } = await render(
      makePreview({
        account_id: null,
        summary: { ...makePreview().summary, first_date: null, last_date: null },
      }),
    )
    expect(find('review-file').text()).toContain('CSV · 4 transactions')
    expect(find('review-file').text()).not.toContain('2026')
    expect(find('review-account').text()).toContain(
      'Choose the account these are from, or add it as a new one.',
    )
    expect(find('review-rows').exists()).toBe(false)
    expect(find('review-save').exists()).toBe(false)
  })

  it('says a saved format read the file, and offers to update it with changes', async () => {
    const saved = makePreview({ profile_id: harborFormat.id })
    const { wizard, find } = await render(saved)
    expect(find('review-saved-format').text()).toBe(
      'Read with your Harbor Credit Union checking format',
    )
    expect(find('review-save').exists()).toBe(false)

    wizard.edited = true
    await flushPromises()
    expect(find('review-saved-format').exists()).toBe(false)
    expect(find('review-save-toggle').text()).toBe(
      'Update the Harbor Credit Union checking format with these changes',
    )
    expect(find('review-format-name').exists()).toBe(false)
  })

  it('updates a saved format that was deleted meanwhile by what it was', async () => {
    const { find } = await render(makePreview({ profile_id: 'format-gone' }), (wizard) => {
      wizard.edited = true
    })
    expect(find('review-saved-format').exists()).toBe(false)
    expect(find('review-save-toggle').text()).toBe('Update the saved format with these changes')
  })

  it('imports one statement at a time from a file with several', async () => {
    const { find, chooseStatement } = await render(qfx)
    expect(find('review-file').text()).toContain('QFX · 4 transactions')
    expect(find('review-save').exists()).toBe(false)
    const statement = find('review-statement')
    expect(statement.text()).toContain(
      'This file has statements for 3 accounts. Import them one at a time.',
    )
    await statement.find('.v-field').trigger('mousedown')
    await flushPromises()
    const items = page().findAll('.v-menu.v-overlay--active .v-list-item')
    expect(items.map((item) => item.text())).toEqual([
      'Harbor Credit Union · Checking · •••• 4410 · 4 transactions',
      'Rainy day fund · Savings · 1 transaction',
      'Statement 3 · 0 transactions',
    ])
    await items[1]!.trigger('click')
    await flushPromises()
    expect(chooseStatement).toHaveBeenCalledWith(1)
  })

  it('reads a one-statement file without asking which', async () => {
    const { find } = await render({ ...qfx, statements: qfx.statements.slice(0, 1) })
    expect(find('review-statement').exists()).toBe(false)
  })

  it('says which rows the bank already shared, and leaves a linked account’s balance to it', async () => {
    const rows = [
      makeRow({ line: 2, date: '2026-09-01' }),
      makeRow({ line: 3, date: '2026-09-03', amount: '-45.00' }),
      makeRow({ line: 4, date: '2026-09-04', amount: '-12.00' }),
    ]
    const { find } = await render(
      makePreview({ account_id: visa.id, rows, bank_history: { start: '2026-09-02', end: null } }),
    )
    expect(find('review-bank-history').text()).toBe(
      'Plaid brings in Rewards Visa’s transactions from Sep 2 on, so the 2 rows from then start unticked. Tick any the bank missed.',
    )
    expect(find('review-bank-balance').text()).toBe(
      'Plaid keeps Rewards Visa’s balance up to date, so importing leaves it at $612.40 owed.',
    )
    expect(find('balance-choice').exists()).toBe(false)
  })

  it.each([
    [1, 'Your automations will sort 1 of the new transactions as they come in.'],
    [1234, 'Your automations will sort 1,234 of the new transactions as they come in.'],
  ])('says how many of the new rows automations will sort: %s', async (sorted, note) => {
    const preview = makePreview()
    const { find } = await render({ ...preview, summary: { ...preview.summary, sorted } })

    expect(find('review-sorted').text()).toBe(note)
  })

  it('says nothing about automations when none will sort a row', async () => {
    const { find } = await render()

    expect(find('review-sorted').exists()).toBe(false)
  })

  it('says when the bank shared some of the file’s days', async () => {
    const { find } = await render(
      makePreview({
        account_id: linkedChecking.id,
        rows: [makeRow({ line: 2, date: '2026-09-03' }), makeRow({ line: 3, date: '2026-09-09' })],
        bank_history: { start: '2026-09-02', end: '2026-09-05' },
      }),
    )
    expect(find('review-bank-history').text()).toBe(
      'Plaid brought in Tartan checking’s transactions from Sep 2 to Sep 5, so the 1 row from those days starts unticked.',
    )
    expect(find('review-bank-balance').text()).toContain('leaves it at $980.00.')
  })

  it('says nothing about the bank’s days when none of the new rows are on them', async () => {
    const { find } = await render(
      makePreview({
        account_id: linkedChecking.id,
        bank_history: { start: '2026-09-10', end: null },
      }),
    )
    expect(find('review-bank-history').exists()).toBe(false)
  })

  it('leaves the balance alone when the file doesn’t say anything about it', async () => {
    const { find } = await render(makePreview({ balance: null }))
    expect(find('balance-choice').exists()).toBe(false)
    expect(find('review-bank-balance').exists()).toBe(false)
  })

  it('brings the format name into view when another saved format has it', async () => {
    const taken = 'There’s already a saved format called Harbor Credit Union checking 2.'
    const { find } = await render(makePreview(), (wizard) => {
      wizard.nameError = taken
    })
    await flushPromises()
    const field = find('review-format-name')
    expect(field.text()).toContain(taken)
    expect(document.activeElement).toBe(field.find('input').element)
  })

  it('has nothing to bring into view once the format isn’t being saved', async () => {
    const { find } = await render(makePreview(), (wizard) => {
      wizard.save = false
      wizard.nameError = 'There’s already a saved format called that.'
    })
    await flushPromises()
    expect(find('review-format-name').exists()).toBe(false)
  })
})
