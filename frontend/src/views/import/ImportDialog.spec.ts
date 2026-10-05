import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as accountsApi from '@/api/accounts'
import { ApiError } from '@/api/client'
import * as api from '@/api/imports'
import type { FileImport, ImportPreview } from '@/api/imports'
import { useImportWizard } from '@/stores/importWizard'
import { page } from '@/test/dom'
import { checking, makeAccount, savings, seedFinance, visa } from '@/test/finance'
import {
  harborFormat,
  later,
  makeCsvPreview,
  makeImport,
  makeOptions,
  makePreview,
  makeRow,
  mapleFormat,
  seedImports,
  statementFile,
} from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import { formatDateRange } from '@/utils/dates'
import ImportDialog from '@/views/import/ImportDialog.vue'

const storeCard = makeAccount({
  id: 'account-store-card',
  name: 'Maple store card',
  type: 'credit_card',
  institution: null,
  balance: '-512.40',
})

const qfx = makePreview({
  format: 'ofx',
  file_name: 'harbor.qfx',
  options: makeOptions({ csv: null }),
  csv: null,
  balance: null,
})

/** What importing the checking account's file adds: its new row, with the file's balance. */
const imported = makeImport({
  id: 'import-new',
  file_name: 'harbor-checking.csv',
  added: 1,
  skipped: 3,
  total: '1875.00',
  balance_change: '331.70',
  first_date: '2026-09-01',
  last_date: '2026-09-01',
  created_at: '2026-09-28T10:00:00Z',
})

async function render() {
  const open = ref(false)
  const chooseFile = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(ImportDialog, {
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onChooseFile: chooseFile,
      }),
  })
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => {
      seedFinance({ accounts: [checking, savings, visa, storeCard] })
      seedImports()
    },
  })
  const wizard = useImportWizard()
  /** What the Import tab does when a file is chosen, with the API reading it as `preview`. */
  async function start(preview: ImportPreview | Promise<ImportPreview> | Error, name?: string) {
    const previewing = vi.spyOn(api, 'previewImport')
    if (preview instanceof Error) previewing.mockRejectedValue(preview)
    else previewing.mockReturnValue(Promise.resolve(preview))
    const calls = previewing.mock.calls.length
    void wizard.start(statementFile(name ?? 'harbor-checking.csv'))
    open.value = true
    // The file is read first, which takes jsdom a few turns.
    await vi.waitFor(() => {
      expect(previewing.mock.calls.length).toBeGreaterThan(calls)
    })
    await flushPromises()
  }
  return { ...mounted, open, chooseFile, wizard, start }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)
const title = () => dialog().find('h2').text()
const steps = () =>
  dialog()
    .findAll('.step-list__step')
    .map((step) => step.text())
const buttons = () =>
  dialog()
    .findAll('.v-card-actions .v-btn')
    .map((button) => button.text())

async function press(name: string) {
  await find(name).trigger('click')
  await flushPromises()
}

/** Has importing answer with `record`, and the lists it reloads answer too. */
function answerImport(record: FileImport | Promise<FileImport> = imported) {
  vi.spyOn(api, 'fetchImports').mockResolvedValue([record as FileImport])
  vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([harborFormat, mapleFormat])
  vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([checking, savings, visa, storeCard])
  return vi.spyOn(api, 'createImport').mockReturnValue(Promise.resolve(record))
}

describe('ImportDialog', () => {
  it('matches a CSV file’s columns, then imports the rows chosen', async () => {
    const { start, router, open } = await render()
    const reading = later<ImportPreview>()
    await start(reading.promise)
    expect(title()).toBe('Reading harbor-checking.csv')
    expect(find('import-progress').text()).toBe('Reading harbor-checking.csv…')
    expect(dialog().find('.step-list').exists()).toBe(false)
    expect(buttons()).toEqual(['Cancel'])

    reading.resolve(makePreview())
    await flushPromises()
    expect(title()).toBe('Match the columns')
    expect(dialog().text()).toContain('Say what each column holds.')
    expect(find('import-columns').exists()).toBe(true)
    expect(steps()).toHaveLength(3)
    expect(buttons()).toEqual(['Cancel', 'Continue'])

    await press('import-continue')
    expect(title()).toBe('Review and import')
    expect(find('import-review').exists()).toBe(true)
    expect(buttons()).toEqual(['Back', 'Cancel', 'Import 1 transaction'])
    await press('import-back')
    expect(title()).toBe('Match the columns')
    await press('import-continue')

    const create = answerImport()
    await press('import-submit')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: checking.id,
        lines: [2],
        balance: 'file',
        save_profile: { id: null, name: 'Harbor Credit Union checking 2' },
      }),
    )
    expect(title()).toBe('Imported harbor-checking.csv')
    expect(dialog().find('.v-avatar').classes()).toContain('text-success')
    const done = find('import-done')
    expect(done.text()).toContain('Everyday checking')
    expect(done.text()).toContain(
      `1 transaction · ${formatDateRange({ start: '2026-09-01', end: '2026-09-01' })}`,
    )
    expect(done.text()).toContain('+$1,875.00')
    expect(
      find('import-done-note')
        .findAll('.v-alert__content > div')
        .map((line) => line.text()),
    ).toEqual([
      'The transactions are on the Transactions page, and your budget counts them. Everyday checking’s balance is now $2,781.88.',
      'The file’s other 3 rows were left out.',
      'Saved the Harbor Credit Union checking 2 format for the bank’s next files.',
    ])
    expect(buttons()).toEqual(['See transactions', 'Done'])

    await press('import-transactions')
    expect(open.value).toBe(false)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/transactions?import=import-new')
    })
  })

  it('reviews an OFX file straight away, and shows it importing', async () => {
    const { start, open } = await render()
    await start(qfx, 'harbor.qfx')
    expect(title()).toBe('Review and import')
    expect(steps()).toHaveLength(2)
    expect(buttons()).toEqual(['Cancel', 'Import 1 transaction'])
    expect(find('balance-choice').exists()).toBe(false)

    const importing = later<FileImport>()
    answerImport(importing.promise)
    await press('import-submit')
    expect(find('import-progress').text()).toBe('Importing 1 transaction into Everyday checking…')
    expect(buttons()).toEqual([])

    importing.resolve({ ...imported, skipped: 1, balance_change: '0.00' })
    await flushPromises()
    expect(
      find('import-done-note')
        .findAll('.v-alert__content > div')
        .map((line) => line.text()),
    ).toEqual([
      'The transactions are on the Transactions page, and your budget counts them.',
      'The file’s other row was left out.',
    ])
    await press('import-finish')
    expect(open.value).toBe(false)
  })

  it.each([
    [1, 'Your automations sorted 1 of them.'],
    [3, 'Your automations sorted 3 of them.'],
  ])('says how many automations sorted once imported: %s', async (sorted, note) => {
    const { start } = await render()
    await start(makePreview({ account_id: visa.id, rows: [makeRow({ amount: '-12.00' })] }))
    await press('import-continue')
    answerImport({ ...imported, account_id: visa.id, skipped: 0, sorted })
    await press('import-submit')

    expect(find('import-done-note').text()).toContain(note)
  })

  it('says what’s owed on a card once imported', async () => {
    const { start } = await render()
    await start(
      makePreview({
        account_id: storeCard.id,
        profile_id: mapleFormat.id,
        rows: [makeRow({ amount: '-87.60' })],
        balance: { current: '-512.40', closing: null, closing_date: null, suggested: 'move' },
      }),
    )
    expect(title()).toBe('Review and import')
    answerImport({ ...imported, account_id: storeCard.id, skipped: 0, balance_change: '-87.60' })
    await press('import-submit')
    expect(find('import-done-note').text()).toBe(
      'The transactions are on the Transactions page, and your budget counts them. Maple store card’s balance is now $600.00 owed.',
    )
  })

  it('leaves a linked account’s balance to its bank', async () => {
    const { start } = await render()
    await start(makePreview({ account_id: visa.id, rows: [makeRow({ amount: '-12.00' })] }))
    await press('import-continue')
    answerImport({ ...imported, account_id: visa.id, skipped: 0 })
    await press('import-submit')
    expect(find('import-done-note').text()).not.toContain('balance is now')
  })

  it('says it imported into an account deleted meanwhile', async () => {
    const { start, wizard } = await render()
    await start(qfx, 'harbor.qfx')
    wizard.save = false
    answerImport({ ...imported, account_id: 'account-gone', skipped: 0 })
    await press('import-submit')
    const done = find('import-done')
    expect(done.text()).toContain('Imported')
    expect(done.find('.v-avatar').exists()).toBe(false)
    expect(find('import-done-note').text()).toBe(
      'The transactions are on the Transactions page, and your budget counts them.',
    )
  })

  it('closes at any step before importing', async () => {
    const { start, open, wizard } = await render()
    const cancel = vi.spyOn(wizard, 'cancel')
    await start(later<ImportPreview>().promise)
    await press('import-close')
    expect(open.value).toBe(false)

    await start(makePreview())
    expect(title()).toBe('Match the columns')
    await press('import-cancel')
    expect(open.value).toBe(false)

    await start(makePreview())
    await press('import-continue')
    wizard.refreshing = true
    await flushPromises()
    expect(find('import-refreshing').exists()).toBe(true)
    await press('import-cancel')
    expect(open.value).toBe(false)

    await start(qfx, 'harbor.qfx')
    await press('dialog-close')
    expect(open.value).toBe(false)
    expect(cancel).toHaveBeenCalledTimes(4)
  })

  it('waits for the columns it needs before going on', async () => {
    const { start, wizard } = await render()
    await start(
      makePreview({
        csv: makeCsvPreview({ missing: ['amount'] }),
        rows: [],
        summary: { ...makePreview().summary, rows: 0, invalid: 0 },
      }),
    )
    expect(find('import-continue').attributes('disabled')).toBeDefined()

    wizard.preview = makePreview()
    wizard.refreshing = true
    await flushPromises()
    expect(find('import-refreshing').exists()).toBe(true)
    expect(find('import-continue').attributes('disabled')).toBeDefined()
    wizard.refreshing = false
    await flushPromises()
    expect(find('import-refreshing').exists()).toBe(false)
    expect(find('import-continue').attributes('disabled')).toBeUndefined()
  })

  it('offers another file when one can’t be read', async () => {
    const { start, open, chooseFile, wizard } = await render()
    await start(
      new ApiError(422, 'This isn’t a statement Cashcove can read.', { code: 'unreadable_file' }),
    )
    expect(title()).toBe('Couldn’t import harbor-checking.csv')
    expect(dialog().find('.v-avatar').classes()).toContain('text-error')
    expect(find('import-notice').text()).toBe('This isn’t a statement Cashcove can read.')
    expect(find('import-failed').text()).toContain('CSV, OFX, QFX, QBO or QIF')
    expect(buttons()).toEqual(['Close', 'Choose another file'])

    await press('import-choose-again')
    expect(chooseFile).toHaveBeenCalledOnce()

    const cancel = vi.spyOn(wizard, 'cancel')
    await press('import-close')
    expect(open.value).toBe(false)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('adds the file’s account as a new one, from what the file says', async () => {
    const { start, wizard } = await render()
    const added = makeAccount({ id: 'account-new', name: 'Harbor checking', mask: '7781' })
    await start(
      makePreview({
        account_id: null,
        new_account: {
          name: 'Harbor checking',
          institution: 'Harbor Credit Union',
          type: 'checking',
          mask: '7781',
          currency: 'USD',
        },
      }),
    )
    await press('import-continue')
    expect(find('import-submit').attributes('disabled')).toBeDefined()

    const create = vi.spyOn(accountsApi, 'createAccount').mockResolvedValue(added)
    const choose = vi.spyOn(wizard, 'chooseAccount').mockImplementation((id) => {
      wizard.accountId = id
    })
    await press('review-new-account')
    const account = page().findAll('.v-overlay--active .app-dialog').at(-1)!
    expect(account.find('h2').text()).toBe('Add an account')
    const value = (name: string) =>
      (account.find(`[data-test="account-${name}"] input`).element as HTMLInputElement).value
    expect(value('name-field')).toBe('Harbor checking')
    expect(value('institution')).toBe('Harbor Credit Union')
    expect(value('mask')).toBe('7781')
    expect(value('balance-field')).toBe('2,781.88')

    await account.find('[data-test="account-save"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Harbor checking', balance: '2781.88' }),
    )
    expect(choose).toHaveBeenCalledWith('account-new')
  })

  it('starts a new account from scratch when the file says nothing about it', async () => {
    const { start } = await render()
    await start({
      ...qfx,
      account_id: null,
      new_account: { name: null, institution: null, type: null, mask: null, currency: null },
    })
    await press('review-new-account')
    const account = page().findAll('.v-overlay--active .app-dialog').at(-1)!
    const value = (name: string) =>
      (account.find(`[data-test="account-${name}"] input`).element as HTMLInputElement).value
    expect(value('name-field')).toBe('')
    expect(value('balance-field')).toBe('')
    expect(account.find('[data-test="account-type-checking"]').attributes('aria-checked')).toBe(
      'true',
    )
  })
})
