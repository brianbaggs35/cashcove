import { createPinia, setActivePinia } from 'pinia'

import * as accountsApi from '@/api/accounts'
import * as aiApi from '@/api/ai'
import { ApiError } from '@/api/client'
import * as api from '@/api/imports'
import type { ImportPreview } from '@/api/imports'
import { useAiStore } from '@/stores/ai'
import { importable, NEEDS_AI, REREAD_DELAY, useImportWizard } from '@/stores/importWizard'
import {
  aiOff,
  makeAiSettings,
  makeProviders,
  makeStatementReading,
  makeStatementRow,
} from '@/test/ai'
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
      new ApiError(422, 'This looks like an Excel workbook.', { code: 'unreadable_file' }),
    )
    await wizard.start(file())
    expect(wizard.step).toBe('failed')
    expect(wizard.notice).toBe('This looks like an Excel workbook.')

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

  it('goes on to the AI’s second opinion when AI is set up and has begun one', async () => {
    const { wizard } = await started()
    wizard.step = 'review'
    const record = makeImport({ id: 'import-new', ai_review_id: 'review-import' })
    vi.spyOn(api, 'createImport').mockResolvedValue(record)
    vi.spyOn(api, 'fetchImports').mockResolvedValue([record])
    vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([])
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([checking])

    await wizard.importRows()

    expect(wizard.step).toBe('ai')
    expect(wizard.record?.ai_review_id).toBe('review-import')
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

describe('import wizard with a PDF statement', () => {
  const pdf = () => new File(['%PDF-1.7'], 'september.pdf', { type: 'application/pdf' })
  /** The preview of what the AI read: its three rows, the last needing its date mended. */
  const statementPreview = (rows = [1, 2, 3]) =>
    makePreview({
      format: 'pdf',
      file_name: 'september.pdf',
      options: makeOptions({ csv: null }),
      csv: null,
      rows: rows.map((line) =>
        makeRow({
          line,
          date: line === 3 ? null : `2026-09-0${line}`,
          amount: line === 2 ? '2400.00' : '-84.12',
          status: line === 3 ? 'invalid' : 'new',
          problem: line === 3 ? 'It has no date.' : null,
        }),
      ),
    })
  /** What the document it sends says, as the API gets it. */
  const sent = (call: unknown) => {
    const { content } = (call as [{ content: string }])[0]
    return JSON.parse(atob(content)) as { rows: { date: string | null; amount: string | null }[] }
  }

  beforeEach(() => {
    const ai = useAiStore()
    ai.providers = makeProviders()
    ai.settings = makeAiSettings()
  })

  it('has the AI read it, then shows what it found for review', async () => {
    const reading = vi.spyOn(aiApi, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
    const previewing = vi.spyOn(api, 'previewImport').mockResolvedValue(statementPreview())
    const wizard = useImportWizard()

    await wizard.start(pdf())

    expect(reading).toHaveBeenCalledWith({
      file_name: 'september.pdf',
      content: btoa('%PDF-1.7'),
    })
    // What was read goes to the preview as a file, for the account it seems to be for.
    expect(previewing).toHaveBeenCalledTimes(1)
    const [request] = previewing.mock.calls[0] as [{ account_id: string; file_name: string }]
    expect(request).toMatchObject({ file_name: 'september.pdf', account_id: 'account-checking' })
    expect(sent(previewing.mock.calls[0]).rows).toHaveLength(3)
    expect(wizard.step).toBe('review')
    expect(wizard.source).toBe('statement')
    expect(wizard.format).toBe('pdf')
    expect(wizard.statementRows).toHaveLength(3)
    expect(wizard.suggestedAccount).toBe('account-checking')
    expect(wizard.skipped).toBe(1)
    expect(wizard.statementNotes).toEqual(
      new Map([[3, 'The date is outside the statement’s dates.']]),
    )
    // The rows that can be imported start ticked, and there's no format to save.
    expect(wizard.selected).toEqual([1, 2])
    expect(wizard.canSave).toBe(false)
    expect(wizard.formatSave).toBeNull()
    expect(wizard.canImport).toBe(true)
  })

  it('says a PDF can only be read with AI, when AI is off, without sending it anywhere', async () => {
    useAiStore().settings = aiOff
    const reading = vi.spyOn(aiApi, 'readStatementWithAi')
    const wizard = useImportWizard()

    await wizard.start(pdf())

    expect(reading).not.toHaveBeenCalled()
    expect(wizard.step).toBe('failed')
    expect(wizard.needsAi).toBe(true)
    expect(wizard.notice).toBe(NEEDS_AI)
    expect(NEEDS_AI).toContain('can only be done with AI')
  })

  it('finds out whether AI is set up before it decides', async () => {
    const ai = useAiStore()
    ai.settings = null
    vi.spyOn(aiApi, 'fetchAiProviders').mockResolvedValue(makeProviders())
    vi.spyOn(aiApi, 'fetchAiSettings').mockResolvedValue(makeAiSettings())
    vi.spyOn(aiApi, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
    vi.spyOn(api, 'previewImport').mockResolvedValue(statementPreview())
    const wizard = useImportWizard()

    await wizard.start(pdf())

    expect(wizard.step).toBe('review')
  })

  it('says why when the AI or the PDF can’t be read', async () => {
    const wizard = useImportWizard()
    const reading = vi.spyOn(aiApi, 'readStatementWithAi')
    reading.mockRejectedValue(
      new ApiError(422, 'There’s no text in this PDF.', { code: 'unreadable_statement' }),
    )

    await wizard.start(pdf())

    expect(wizard.step).toBe('failed')
    expect(wizard.notice).toBe('There’s no text in this PDF.')
    expect(wizard.needsAi).toBe(false)

    await wizard.start(new File([], 'empty.pdf'))
    expect(wizard.notice).toBe('empty.pdf is empty. Download it from your bank again.')
  })

  it('says why when what was read can’t be previewed', async () => {
    vi.spyOn(aiApi, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
    vi.spyOn(api, 'previewImport').mockRejectedValue(new Error('Offline'))
    const wizard = useImportWizard()

    await wizard.start(pdf())

    expect(wizard.step).toBe('failed')
    expect(wizard.notice).toBe('Offline')
  })

  it('shows only the latest PDF, however slowly each is read', async () => {
    const slow = later<aiApi.StatementReading>()
    const quick = makeStatementReading({ file_name: 'october.pdf' })
    const reading = vi.spyOn(aiApi, 'readStatementWithAi')
    reading.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(quick)
    const previewing = vi.spyOn(api, 'previewImport').mockResolvedValue(statementPreview())
    const wizard = useImportWizard()

    const first = wizard.start(pdf())
    await vi.waitFor(() => {
      expect(reading).toHaveBeenCalledTimes(1)
    })
    await wizard.start(new File(['%PDF-1.7'], 'october.pdf', { type: 'application/pdf' }))
    slow.resolve(makeStatementReading())
    await first

    expect(wizard.fileName).toBe('october.pdf')
    expect(previewing).toHaveBeenCalledTimes(1)
  })

  it('drops a PDF that was set aside while AI was being looked up', async () => {
    const ai = useAiStore()
    ai.settings = null
    const settings = later<aiApi.AiSettings>()
    vi.spyOn(aiApi, 'fetchAiProviders').mockResolvedValue(makeProviders())
    vi.spyOn(aiApi, 'fetchAiSettings').mockReturnValue(settings.promise)
    const reading = vi.spyOn(aiApi, 'readStatementWithAi')
    const wizard = useImportWizard()

    const starting = wizard.start(pdf())
    wizard.reset()
    settings.resolve(makeAiSettings())
    await starting

    expect(reading).not.toHaveBeenCalled()
    expect(wizard.step).toBe('reading')
    expect(wizard.needsAi).toBe(false)
  })

  it('says nothing of a PDF that failed to read after it was set aside', async () => {
    const failing = later<aiApi.StatementReading>()
    const reading = vi.spyOn(aiApi, 'readStatementWithAi').mockReturnValue(failing.promise)
    const wizard = useImportWizard()

    const starting = wizard.start(pdf())
    await vi.waitFor(() => {
      expect(reading).toHaveBeenCalledTimes(1)
    })
    wizard.reset()
    failing.reject(new Error('Offline'))
    await starting

    expect(wizard.notice).toBeNull()
    expect(wizard.step).toBe('reading')
  })

  it('opens at the review with what the AI already read, as the chat does', async () => {
    const previewing = vi.spyOn(api, 'previewImport').mockResolvedValue(statementPreview())
    const wizard = useImportWizard()
    wizard.reset()

    await wizard.openReading('september.pdf', makeStatementReading({ account_id: null }))

    expect(wizard.step).toBe('review')
    expect(wizard.fileName).toBe('september.pdf')
    expect(previewing).toHaveBeenCalledWith(expect.objectContaining({ account_id: null }))

    previewing.mockRejectedValue(new Error('Offline'))
    await wizard.openReading('september.pdf', makeStatementReading())
    expect(wizard.step).toBe('failed')
  })

  it('ignores a preview that comes after the statement was set aside', async () => {
    const late = later<ImportPreview>()
    vi.spyOn(api, 'previewImport').mockReturnValue(late.promise)
    const wizard = useImportWizard()

    const opening = wizard.openReading('september.pdf', makeStatementReading())
    wizard.reset()
    late.resolve(statementPreview())
    await opening

    expect(wizard.preview).toBeNull()
    expect(wizard.step).toBe('reading')

    const failing = later<ImportPreview>()
    vi.spyOn(api, 'previewImport').mockReturnValue(failing.promise)
    const again = wizard.openReading('september.pdf', makeStatementReading())
    wizard.reset()
    failing.reject(new Error('Offline'))
    await again
    expect(wizard.notice).toBeNull()
  })

  describe('being corrected', () => {
    async function opened() {
      vi.spyOn(aiApi, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
      const previewing = vi.spyOn(api, 'previewImport').mockResolvedValue(statementPreview())
      const wizard = useImportWizard()
      await wizard.start(pdf())
      vi.useFakeTimers()
      return { wizard, previewing }
    }

    it('corrects a row, and reads the statement again once the changes stop', async () => {
      const { wizard, previewing } = await opened()
      previewing.mockClear()

      wizard.editRow(3, { date: '2026-09-06', payee: 'Zelle Payment' })
      wizard.editRow(3, { amount: '-55.00' })

      // The rows say what they are now, with no reason left to check the one corrected.
      expect(wizard.statementRows[2]).toMatchObject({
        date: '2026-09-06',
        payee: 'Zelle Payment',
        amount: '-55.00',
        note: null,
      })
      expect(wizard.statementNotes.size).toBe(0)
      expect(wizard.refreshing).toBe(true)
      expect(previewing).not.toHaveBeenCalled()

      previewing.mockResolvedValue(statementPreview())
      await vi.advanceTimersByTimeAsync(REREAD_DELAY)

      expect(previewing).toHaveBeenCalledTimes(1)
      expect(sent(previewing.mock.calls[0]).rows[2]).toEqual({
        date: '2026-09-06',
        payee: 'Zelle Payment',
        amount: '-55.00',
      })
      expect(wizard.refreshing).toBe(false)
    })

    it('keeps what was ticked and what wasn’t, and ticks a row that can now be imported', async () => {
      const { wizard, previewing } = await opened()
      wizard.select([2], false)
      expect(wizard.selected).toEqual([1])

      wizard.editRow(3, { date: '2026-09-06' })
      previewing.mockResolvedValue(
        makePreview({
          ...statementPreview(),
          rows: [1, 2, 3].map((line) => makeRow({ line, date: '2026-09-06', status: 'new' })),
        }),
      )
      await vi.advanceTimersByTimeAsync(REREAD_DELAY)

      // The first stayed ticked, the second stayed unticked, and the third is new to ticking.
      expect(wizard.selected).toEqual([1, 3])
    })

    it('keeps the ticks when another account is chosen too', async () => {
      const { wizard, previewing } = await opened()
      previewing.mockResolvedValue(
        makePreview({
          ...statementPreview(),
          account_id: 'account-savings',
          rows: [
            makeRow({ line: 1, status: 'duplicate' }),
            makeRow({ line: 2, status: 'new' }),
            makeRow({ line: 3, status: 'invalid' }),
          ],
        }),
      )

      wizard.chooseAccount('account-savings')
      await vi.advanceTimersByTimeAsync(0)

      expect(wizard.accountId).toBe('account-savings')
      expect(wizard.selected).toEqual([2])
    })

    it('flips which way every amount went', async () => {
      const { wizard, previewing } = await opened()
      previewing.mockClear()
      wizard.editRow(2, { amount: null })

      wizard.flipSigns()

      expect(wizard.statementRows.map((row) => row.amount)).toEqual(['84.12', null, '50.00'])
      await vi.advanceTimersByTimeAsync(REREAD_DELAY)
      expect(sent(previewing.mock.calls.at(-1)).rows.map((row) => row.amount)).toEqual([
        '84.12',
        null,
        '50.00',
      ])
    })

    it('starts over when another file is chosen', async () => {
      const { wizard } = await opened()

      wizard.reset()

      expect(wizard.source).toBe('file')
      expect(wizard.statementRows).toEqual([])
      expect(wizard.needsAi).toBe(false)
      expect(wizard.suggestedAccount).toBeNull()
      expect(wizard.skipped).toBe(0)
    })
  })

  it('imports what was read, as a PDF the account is told about', async () => {
    vi.spyOn(aiApi, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
    vi.spyOn(api, 'previewImport').mockResolvedValue(statementPreview())
    const created = vi
      .spyOn(api, 'createImport')
      .mockResolvedValue(
        makeImport({ format: 'pdf', file_name: 'september.pdf', profile_id: null, added: 2 }),
      )
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([checking])
    const wizard = useImportWizard()
    await wizard.start(pdf())

    await wizard.importRows()

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        file_name: 'september.pdf',
        account_id: 'account-checking',
        lines: [1, 2],
        save_profile: null,
        profile_id: null,
      }),
    )
    expect(wizard.step).toBe('done')
    expect(wizard.record?.format).toBe('pdf')
  })

  it('makes a row from nothing but what the AI said', () => {
    expect(makeStatementRow().line).toBe(1)
  })
})
