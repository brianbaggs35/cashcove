import { createPinia, setActivePinia } from 'pinia'

import * as accountsApi from '@/api/accounts'
import { ApiError } from '@/api/client'
import * as api from '@/api/imports'
import type { ImportPreview } from '@/api/imports'
import { importable, REREAD_DELAY, useImportWizard } from '@/stores/importWizard'
import { checking, makeAccount, savings, seedFinance, visa } from '@/test/finance'
import {
  coffeeRow,
  groceriesRow,
  harborFormat,
  later,
  makeCsvPreview,
  makeImport,
  makeOptions,
  makePreview,
  makeRow,
  payroll,
  pendingRow,
  seedImports,
} from '@/test/imports'

const statement = { file_name: 'harbor-checking.csv', content: btoa('Date,Amount\n') }
const file = () => new File(['Date,Amount\n'], 'harbor-checking.csv', { type: 'text/csv' })
const ofx = makePreview({
  format: 'ofx',
  file_name: 'harbor-checking.qfx',
  options: makeOptions({ csv: null }),
  csv: null,
})

/** The wizard with a file read, as the Import tab starts it. */
async function started(preview: ImportPreview = makePreview()) {
  const wizard = useImportWizard()
  const previewing = vi.spyOn(api, 'previewImport').mockResolvedValue(preview)
  await wizard.start(file())
  return { wizard, previewing }
}

beforeEach(() => {
  setActivePinia(createPinia())
  seedFinance()
  seedImports()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('import wizard', () => {
  it('starts empty', () => {
    const wizard = useImportWizard()
    expect(wizard.step).toBe('reading')
    expect(wizard.format).toBeNull()
    expect(wizard.account).toBeUndefined()
    expect(wizard.linked).toBe(false)
    expect(wizard.selectedTotal).toBe('0.00')
    expect(wizard.profileName).toBeNull()
    expect(wizard.canSave).toBe(false)
    expect(wizard.formatSave).toBeNull()
    expect(wizard.canImport).toBe(false)
  })

  it('knows which rows can be imported', () => {
    expect([payroll, groceriesRow, coffeeRow, pendingRow].map(importable)).toEqual([
      true,
      false,
      true,
      false,
    ])
  })

  it('reads a new CSV file and asks for its columns first', async () => {
    const { wizard, previewing } = await started()

    expect(previewing).toHaveBeenCalledWith(statement)
    expect(wizard.step).toBe('columns')
    expect(wizard.fileName).toBe('harbor-checking.csv')
    expect(wizard.upload).toEqual(statement)
    expect(wizard.format).toBe('csv')
    expect(wizard.options).toEqual(makeOptions())
    expect(wizard.account).toEqual(checking)
    // New rows start ticked; ones that might be there already don't.
    expect(wizard.selected).toEqual([payroll.line])
    expect(wizard.selectedTotal).toBe('1875.00')
    expect(wizard.balance).toBe('file')
    // Named for the bank and kind of account, next to the saved format with that name.
    expect(wizard.formatName).toBe('Harbor Credit Union checking 2')
    expect(wizard.canSave).toBe(true)
    expect(wizard.formatSave).toEqual({ id: null, name: 'Harbor Credit Union checking 2' })
  })

  it('names a new format for the account, however many have its name', async () => {
    seedImports({ formats: [] })
    const first = await started()
    expect(first.wizard.formatName).toBe('Harbor Credit Union checking')

    seedImports({
      formats: [
        harborFormat,
        { ...harborFormat, id: 'format-2', name: 'HARBOR CREDIT UNION CHECKING 2' },
      ],
    })
    first.wizard.reset()
    await first.wizard.start(file())
    expect(first.wizard.formatName).toBe('Harbor Credit Union checking 3')

    // Accounts without a bank go by their own name, and no account means no name yet.
    seedFinance({ accounts: [makeAccount({ institution: null, name: 'Cash jar' })] })
    first.wizard.reset()
    await first.wizard.start(file())
    expect(first.wizard.formatName).toBe('Cash jar')

    vi.spyOn(api, 'previewImport').mockResolvedValue(makePreview({ account_id: null }))
    first.wizard.reset()
    await first.wizard.start(file())
    expect(first.wizard.formatName).toBe('')
    expect(first.wizard.canImport).toBe(false)
  })

  it('goes straight to review for files that need no columns matched', async () => {
    const { wizard } = await started(ofx)
    expect(wizard.step).toBe('review')
    expect(wizard.canSave).toBe(false)
    expect(wizard.canImport).toBe(true)

    // A CSV file its saved format read cleanly.
    const saved = makePreview({ profile_id: harborFormat.id })
    vi.spyOn(api, 'previewImport').mockResolvedValue(saved)
    await wizard.start(file())
    expect(wizard.step).toBe('review')
    expect(wizard.profileName).toBe(harborFormat.name)
    expect(wizard.canSave).toBe(false)
  })

  it('asks for columns when a saved format reads a file badly', async () => {
    const wizard = useImportWizard()
    const previewing = vi.spyOn(api, 'previewImport')
    const cases: ImportPreview[] = [
      makePreview({ profile_id: harborFormat.id, csv: makeCsvPreview({ missing: ['amount'] }) }),
      makePreview({ profile_id: harborFormat.id, rows: [] }),
      makePreview({ profile_id: harborFormat.id, rows: [pendingRow] }),
    ]
    for (const preview of cases) {
      previewing.mockResolvedValueOnce(preview)
      await wizard.start(file())
      expect(wizard.step).toBe('columns')
    }
  })

  it('says why a file could not be read', async () => {
    const wizard = useImportWizard()
    vi.spyOn(api, 'previewImport').mockRejectedValue(
      new ApiError(422, 'PDF statements can’t be imported.', { code: 'unreadable_file' }),
    )
    await wizard.start(file())
    expect(wizard.step).toBe('failed')
    expect(wizard.notice).toBe('PDF statements can’t be imported.')

    await wizard.start(new File([], 'empty.csv'))
    expect(wizard.notice).toBe('empty.csv is empty. Download it from your bank again.')
  })

  it('shows only the latest file chosen', async () => {
    const wizard = useImportWizard()
    const first = later<ImportPreview>()
    const failing = later<ImportPreview>()
    vi.spyOn(api, 'previewImport')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce(ofx)

    const reading = wizard.start(file())
    const failed = wizard.start(file())
    await wizard.start(file())
    first.resolve(makePreview())
    failing.reject(new Error('Too slow.'))
    await Promise.all([reading, failed])

    expect(wizard.format).toBe('ofx')
    expect(wizard.step).toBe('review')
    expect(wizard.notice).toBeNull()
  })

  it('reads the file again with changed columns once they settle', async () => {
    const { wizard, previewing } = await started()
    vi.useFakeTimers()
    const read = makePreview({ rows: [payroll] })
    previewing.mockResolvedValue(read)
    const options = makeOptions({ date_order: 'dmy' })

    wizard.changeOptions(makeOptions({ date_order: 'ymd' }))
    wizard.changeOptions(options)
    expect(wizard.edited).toBe(true)
    expect(wizard.refreshing).toBe(true)
    expect(wizard.options).toEqual(options)
    await vi.advanceTimersByTimeAsync(REREAD_DELAY)

    expect(previewing).toHaveBeenCalledTimes(2)
    expect(previewing).toHaveBeenLastCalledWith({
      ...statement,
      profile_id: null,
      statement: 0,
      options,
      account_id: checking.id,
    })
    expect(wizard.refreshing).toBe(false)
    expect(wizard.preview).toEqual(read)
  })

  it('says when the file could not be read again, and ignores readings overtaken', async () => {
    const { wizard, previewing } = await started()
    const slow = later<ImportPreview>()
    previewing.mockReturnValueOnce(slow.promise)

    const overtaken = wizard.refresh()
    previewing.mockRejectedValueOnce(new ApiError(0, 'Offline.'))
    await wizard.refresh()
    expect(wizard.notice).toBe('Offline.')
    expect(wizard.refreshing).toBe(false)

    slow.reject(new Error('Too slow.'))
    await overtaken
    expect(wizard.notice).toBe('Offline.')

    // A reading the dialog stopped waiting for doesn't show either.
    const stopped = later<ImportPreview>()
    previewing.mockReturnValueOnce(stopped.promise)
    const refreshing = wizard.refresh()
    wizard.cancel()
    expect(wizard.refreshing).toBe(false)
    expect(wizard.upload).toBeNull()
    stopped.resolve(makePreview({ rows: [] }))
    await refreshing
    expect(wizard.preview?.rows).toHaveLength(4)
  })

  it('compares the rows with another account, or another statement', async () => {
    const { wizard, previewing } = await started(ofx)
    previewing.mockResolvedValue({ ...ofx, account_id: savings.id })

    wizard.chooseAccount(savings.id)
    expect(wizard.accountId).toBe(savings.id)
    await vi.waitFor(() => {
      expect(wizard.refreshing).toBe(false)
    })
    expect(previewing).toHaveBeenLastCalledWith(
      expect.objectContaining({ account_id: savings.id, statement: 0 }),
    )

    wizard.chooseStatement(1)
    await vi.waitFor(() => {
      expect(wizard.refreshing).toBe(false)
    })
    expect(previewing).toHaveBeenLastCalledWith(
      expect.objectContaining({ account_id: null, statement: 1 }),
    )
  })

  it('keeps a format name someone typed', async () => {
    const { wizard, previewing } = await started()
    wizard.nameError = 'Taken.'
    wizard.renameFormat('Harbor checking, new website')
    expect(wizard.nameError).toBeNull()

    previewing.mockResolvedValue(makePreview({ account_id: savings.id }))
    await wizard.refresh()
    expect(wizard.formatName).toBe('Harbor checking, new website')
  })

  it('ticks and unticks rows, in the file’s order', async () => {
    const { wizard } = await started()
    wizard.select([coffeeRow.line], true)
    wizard.select([payroll.line, coffeeRow.line], true)
    expect(wizard.selected).toEqual([payroll.line, coffeeRow.line])
    expect(wizard.selectedTotal).toBe('1870.50')

    wizard.select([payroll.line], false)
    expect(wizard.selected).toEqual([coffeeRow.line])
  })

  it('starts rows on days the bank already shared unticked', async () => {
    const early = makeRow({ line: 6, date: '2025-12-30' })
    const { wizard } = await started(
      makePreview({
        rows: [payroll, early],
        bank_history: { start: '2026-01-01', end: null },
        balance: null,
      }),
    )
    expect(wizard.selected).toEqual([early.line])
    expect(wizard.balance).toBe('keep')
  })

  it('saves changes to a saved format under its own name', async () => {
    const { wizard } = await started(makePreview({ profile_id: harborFormat.id, rows: [] }))
    expect(wizard.canSave).toBe(false)
    wizard.changeOptions(makeOptions({ flip: true }))
    expect(wizard.canSave).toBe(true)
    expect(wizard.formatSave).toEqual({ id: harborFormat.id, name: harborFormat.name })

    // One deleted meanwhile is saved again under the name typed.
    seedImports({ formats: [] })
    wizard.renameFormat(' Harbor checking ')
    expect(wizard.formatSave).toEqual({ id: harborFormat.id, name: 'Harbor checking' })

    wizard.save = false
    expect(wizard.formatSave).toBeNull()
    wizard.cancel()
  })

  it('imports only with an account, some rows ticked and a name to save the format under', async () => {
    const { wizard } = await started()
    wizard.step = 'review'
    expect(wizard.canImport).toBe(true)

    wizard.renameFormat('  ')
    expect(wizard.canImport).toBe(false)
    wizard.save = false
    expect(wizard.canImport).toBe(true)

    wizard.select([payroll.line], false)
    expect(wizard.canImport).toBe(false)
    wizard.select([payroll.line], true)
    wizard.refreshing = true
    expect(wizard.canImport).toBe(false)
  })

  it('imports the ticked rows and reloads what they changed', async () => {
    const { wizard } = await started()
    wizard.step = 'review'
    wizard.select([coffeeRow.line], true)
    wizard.balance = 'move'
    const record = makeImport({ id: 'import-new', added: 2, skipped: 2 })
    const create = vi.spyOn(api, 'createImport').mockResolvedValue(record)
    const reloadImports = vi.spyOn(api, 'fetchImports').mockResolvedValue([record])
    vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([])
    const reloadAccounts = vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([checking])

    await wizard.importRows()

    expect(create).toHaveBeenCalledWith({
      ...statement,
      profile_id: null,
      statement: 0,
      options: makeOptions(),
      account_id: checking.id,
      lines: [payroll.line, coffeeRow.line],
      balance: 'move',
      save_profile: { id: null, name: 'Harbor Credit Union checking 2' },
    })
    expect(wizard.step).toBe('done')
    expect(wizard.record).toEqual(record)
    await vi.waitFor(() => {
      expect(reloadImports).toHaveBeenCalledOnce()
    })
    expect(reloadAccounts).toHaveBeenCalledOnce()
  })

  it('leaves a linked account’s balance to its bank', async () => {
    const { wizard } = await started({ ...ofx, account_id: visa.id })
    expect(wizard.linked).toBe(true)
    wizard.balance = 'move'
    const create = vi.spyOn(api, 'createImport').mockResolvedValue(makeImport())
    vi.spyOn(api, 'fetchImports').mockResolvedValue([])
    vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([])
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([])

    await wizard.importRows()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 'keep', save_profile: null }),
    )
  })

  it('says why importing failed, and where', async () => {
    const { wizard } = await started()
    const create = vi.spyOn(api, 'createImport')

    create.mockRejectedValueOnce(
      new ApiError(409, 'There’s already a saved format with that name.', {
        code: 'name_taken',
      }),
    )
    await wizard.importRows()
    expect(wizard.step).toBe('review')
    expect(wizard.nameError).toBe('There’s already a saved format with that name.')
    expect(wizard.notice).toBeNull()

    create.mockRejectedValueOnce(new Error('Offline.'))
    await wizard.importRows()
    expect(wizard.nameError).toBeNull()
    expect(wizard.notice).toBe('Offline.')

    // Declining to confirm who you are is nothing to report.
    create.mockRejectedValueOnce(new ApiError(401, 'Confirm.', { code: 'verification_required' }))
    await wizard.importRows()
    expect(wizard.notice).toBeNull()
  })

  it('shows what’s left when someone else imported the rows meanwhile', async () => {
    const { wizard, previewing } = await started()
    vi.spyOn(api, 'createImport').mockRejectedValue(
      new ApiError(409, 'They’re already in the account.', { code: 'nothing_to_import' }),
    )
    previewing.mockResolvedValue(makePreview({ rows: [groceriesRow] }))

    await wizard.importRows()
    expect(wizard.notice).toBe('They’re already in the account.')
    await vi.waitFor(() => {
      expect(wizard.preview?.rows).toEqual([groceriesRow])
    })
    expect(previewing).toHaveBeenCalledTimes(2)
  })
})
