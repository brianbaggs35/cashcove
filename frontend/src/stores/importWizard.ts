import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { Account } from '@/api/accounts'
import { readStatementWithAi, type StatementReading, type StatementRow } from '@/api/ai'
import { ApiError, errorMessage, isCancelled } from '@/api/client'
import {
  createImport,
  previewImport,
  type BalanceChoice,
  type FileImport,
  type ImportFile,
  type ImportOptions,
  type ImportPreview,
  type PreviewRequest,
  type PreviewRow,
} from '@/api/imports'
import { accountType } from '@/components/finance/accountTypes'
import { useAccountsStore } from '@/stores/accounts'
import { useAiStore } from '@/stores/ai'
import { useImportsStore } from '@/stores/imports'
import { negate, sumAmounts } from '@/utils/money'
import { coveredByBank } from '@/views/import/columns'
import { readStatement } from '@/views/import/file'
import { isPdf, readPdf, statementDocument } from '@/views/import/statement'

export type ImportStep = 'reading' | 'columns' | 'review' | 'importing' | 'done' | 'ai' | 'failed'

/** How long to wait after a change to the columns before reading the file again. */
export const REREAD_DELAY = 350

const IMPORTABLE = new Set(['new', 'possible_duplicate'])

/** What to say to someone who chooses a PDF when AI isn't set up. */
export const NEEDS_AI =
  'Reading a PDF statement can only be done with AI. An admin can set it up in Settings > AI, or you can download a CSV, OFX or QFX file from your bank instead.'

export const importable = (row: PreviewRow) => IMPORTABLE.has(row.status)

/** New rows start ticked, unless the bank's own transactions already cover their day. */
function defaultLines(preview: ImportPreview): number[] {
  return preview.rows
    .filter((row) => row.status === 'new' && !coveredByBank(row, preview.bank_history))
    .map((row) => row.line)
}

/**
 * Which rows are ticked once a statement's rows have changed: the ones that were ticked stay
 * ticked, and the ones that were left unticked stay that way. A row that couldn't be imported
 * before and can be now starts as a new row does.
 */
function retained(
  before: ImportPreview,
  ticked: readonly number[],
  after: ImportPreview,
): number[] {
  const couldBe = new Set(before.rows.filter(importable).map((row) => row.line))
  const wasTicked = new Set(ticked)
  const fresh = new Set(defaultLines(after))
  return after.rows
    .filter(
      (row) =>
        importable(row) && (couldBe.has(row.line) ? wasTicked.has(row.line) : fresh.has(row.line)),
    )
    .map((row) => row.line)
}

/** A CSV file has columns to match, unless a saved format read it cleanly. */
function needsColumns(preview: ImportPreview): boolean {
  const { summary, csv } = preview
  if (!csv) return false
  const clean = !csv.missing.length && summary.rows > 0 && summary.invalid < summary.rows
  return !(preview.profile_id && clean)
}

/**
 * What a new saved format is called at first: the bank's name and the kind of account, with a
 * number when another saved format has that name already.
 */
function formatNameFor(account: Account | undefined, taken: ReadonlySet<string>): string {
  if (!account) return ''
  const kind = accountType(account.type).title.toLowerCase()
  const name = (account.institution ? `${account.institution} ${kind}` : account.name)
    .slice(0, 76)
    .trim()
  let unique = name
  let number = 2
  while (taken.has(unique.toLowerCase())) {
    unique = `${name} ${number}`
    number += 1
  }
  return unique
}

/**
 * Importing one statement file: reading it, matching a CSV file's columns, choosing the account
 * and which rows to import, then importing them. Nothing is saved until the last step.
 */
export const useImportWizard = defineStore('import-wizard', () => {
  const accounts = useAccountsStore()
  const ai = useAiStore()
  const imports = useImportsStore()

  const step = ref<ImportStep>('reading')
  const fileName = ref('')
  const upload = shallowRef<ImportFile | null>(null)
  const preview = shallowRef<ImportPreview | null>(null)
  const options = shallowRef<ImportOptions | null>(null)
  /** The columns or how they're read were changed here, rather than as detected or saved. */
  const edited = ref(false)
  const accountId = ref<string | null>(null)
  const selected = shallowRef<number[]>([])
  const balance = ref<BalanceChoice>('keep')
  const save = ref(true)
  const formatName = ref('')
  const nameChanged = ref(false)
  const refreshing = ref(false)
  const notice = ref<string | null>(null)
  const nameError = ref<string | null>(null)
  const record = shallowRef<FileImport | null>(null)
  /** Where the rows came from: a file Cashcove read, or a PDF statement the AI read. */
  const source = ref<'file' | 'statement'>('file')
  /** What the AI read off a PDF statement, which can be corrected before it's imported. */
  const statementRows = shallowRef<StatementRow[]>([])
  /** A PDF was chosen when AI isn't set up. */
  const needsAi = ref(false)
  /** The account the statement seemed to be for, and how many lines weren't transactions. */
  const suggestedAccount = ref<string | null>(null)
  const skipped = ref(0)
  /** Only the latest file and the latest reading of it get to show. */
  let latest = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const format = computed(() => preview.value?.format ?? null)
  const account = computed(() => accounts.find(accountId.value))
  /** Its bank keeps its balance through Plaid. */
  const linked = computed(() => account.value?.source === 'plaid')
  /** What the ticked rows add up to. */
  const selectedTotal = computed(() => {
    const chosen = new Set(selected.value)
    const rows = preview.value?.rows ?? []
    return sumAmounts(
      rows.flatMap((row) => (chosen.has(row.line) && row.amount ? [row.amount] : [])),
    )
  })
  const profileName = computed(() => imports.findFormat(preview.value?.profile_id)?.name ?? null)
  /** Why rows the AI read should be checked, by the row's number. */
  const statementNotes = computed(
    () =>
      new Map(
        statementRows.value.flatMap((row) => (row.note ? [[row.line, row.note] as const] : [])),
      ),
  )
  /** How the file was read can be saved: a CSV file's new format, or changes to its saved one. */
  const canSave = computed(() => {
    const current = preview.value
    return current?.format === 'csv' && (!current.profile_id || edited.value)
  })
  const formatSave = computed(() => {
    if (!canSave.value || !save.value) return null
    const id = (preview.value as ImportPreview).profile_id
    return { id, name: (id && profileName.value) || formatName.value.trim() }
  })
  const canImport = computed(
    () =>
      step.value === 'review' &&
      !refreshing.value &&
      !!account.value &&
      selected.value.length > 0 &&
      (!formatSave.value || formatSave.value.name.length > 0),
  )

  function reset() {
    latest += 1
    clearTimeout(timer)
    step.value = 'reading'
    fileName.value = ''
    upload.value = null
    preview.value = null
    options.value = null
    edited.value = false
    accountId.value = null
    selected.value = []
    balance.value = 'keep'
    save.value = true
    formatName.value = ''
    nameChanged.value = false
    refreshing.value = false
    notice.value = null
    nameError.value = null
    record.value = null
    source.value = 'file'
    statementRows.value = []
    needsAi.value = false
    suggestedAccount.value = null
    skipped.value = 0
  }

  /** Stops reading the file, e.g. when the dialog closes, and lets the file go. */
  function cancel() {
    latest += 1
    clearTimeout(timer)
    refreshing.value = false
    upload.value = null
  }

  function show(next: ImportPreview) {
    preview.value = next
    options.value = next.options
    accountId.value = next.account_id
    selected.value = defaultLines(next)
    balance.value = next.balance?.suggested ?? 'keep'
    if (!nameChanged.value) {
      const taken = new Set(imports.formats.map((saved) => saved.name.toLowerCase()))
      formatName.value = formatNameFor(account.value, taken)
    }
  }

  /** Shows what the AI read off a PDF statement, for checking before anything is imported. */
  async function showReading(name: string, reading: StatementReading, request: number) {
    source.value = 'statement'
    const document = statementDocument(name, reading.rows)
    try {
      const first = await previewImport({ ...document, account_id: reading.account_id })
      if (request !== latest) return
      statementRows.value = reading.rows
      suggestedAccount.value = reading.account_id
      skipped.value = reading.skipped
      upload.value = document
      show(first)
      step.value = 'review'
    } catch (error) {
      if (request !== latest) return
      notice.value = errorMessage(error)
      step.value = 'failed'
    }
  }

  /** Has the AI read a chosen PDF statement, once AI is known to be set up. */
  async function startPdf(file: File, request: number) {
    source.value = 'statement'
    await ai.ensureLoaded()
    if (request !== latest) return
    if (!ai.configured) {
      needsAi.value = true
      notice.value = NEEDS_AI
      step.value = 'failed'
      return
    }
    try {
      const reading = await readStatementWithAi(await readPdf(file))
      if (request !== latest) return
      await showReading(file.name, reading, request)
    } catch (error) {
      if (request !== latest) return
      notice.value = errorMessage(error)
      step.value = 'failed'
    }
  }

  /** Opens at the review with a statement the AI has already read, as the AI tab's chat does. */
  async function openReading(name: string, reading: StatementReading) {
    reset()
    fileName.value = name
    await showReading(name, reading, latest)
  }

  /** Reads a newly chosen file the way that fits it best: a PDF is read by the AI. */
  async function start(file: File) {
    reset()
    const request = latest
    fileName.value = file.name
    if (isPdf(file)) {
      await startPdf(file, request)
      return
    }
    try {
      const statement = await readStatement(file)
      const first = await previewImport(statement)
      if (request !== latest) return
      upload.value = statement
      show(first)
      step.value = needsColumns(first) ? 'columns' : 'review'
    } catch (error) {
      if (request !== latest) return
      notice.value = errorMessage(error)
      step.value = 'failed'
    }
  }

  /** Reads the file again, with the changes asked for and everything else as it was. */
  async function refresh(changes: Partial<PreviewRequest> = {}) {
    const current = preview.value as ImportPreview
    const ticked = selected.value
    const request = ++latest
    clearTimeout(timer)
    refreshing.value = true
    notice.value = null
    try {
      const next = await previewImport({
        ...(upload.value as ImportFile),
        profile_id: current.profile_id,
        statement: current.statement,
        options: options.value,
        account_id: current.account_id,
        ...changes,
      })
      if (request === latest) {
        show(next)
        if (source.value === 'statement') selected.value = retained(current, ticked, next)
      }
    } catch (error) {
      if (request === latest) notice.value = errorMessage(error)
    } finally {
      if (request === latest) refreshing.value = false
    }
  }

  /** Reads the statement's rows again once they've stopped changing. */
  function restate() {
    upload.value = statementDocument(fileName.value, statementRows.value)
    refreshing.value = true
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), REREAD_DELAY)
  }

  /** Corrects a row the AI read: its date, its payee or its amount. */
  function editRow(
    line: number,
    changes: Partial<Pick<StatementRow, 'date' | 'payee' | 'amount'>>,
  ) {
    statementRows.value = statementRows.value.map((row) =>
      row.line === line ? { ...row, ...changes, note: null } : row,
    )
    restate()
  }

  /** Has every amount go the other way, for a statement that writes money in and out backwards. */
  function flipSigns() {
    statementRows.value = statementRows.value.map((row) => ({
      ...row,
      amount: row.amount === null ? null : negate(row.amount),
    }))
    restate()
  }

  /** Takes changed columns or reading options, and reads the file again once they settle. */
  function changeOptions(next: ImportOptions) {
    options.value = next
    edited.value = true
    refreshing.value = true
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), REREAD_DELAY)
  }

  function chooseAccount(id: string) {
    accountId.value = id
    void refresh({ account_id: id })
  }

  /** Another account's statement, in a file that has several; its likeliest account goes with it. */
  function chooseStatement(index: number) {
    void refresh({ statement: index, account_id: null })
  }

  function renameFormat(name: string) {
    formatName.value = name
    nameChanged.value = true
    nameError.value = null
  }

  function select(lines: number[], on: boolean) {
    const chosen = new Set(selected.value)
    for (const line of lines) {
      if (on) chosen.add(line)
      else chosen.delete(line)
    }
    // In the file's order, as they're imported.
    selected.value = (preview.value as ImportPreview).rows
      .filter((row) => chosen.has(row.line))
      .map((row) => row.line)
  }

  function failed(error: unknown) {
    if (isCancelled(error)) return
    const code = error instanceof ApiError ? error.code : null
    // Someone else imported them meanwhile: this shows what's left, and why.
    if (code === 'nothing_to_import') void refresh()
    if (code === 'name_taken') nameError.value = errorMessage(error)
    else notice.value = errorMessage(error)
  }

  async function importRows() {
    const current = preview.value as ImportPreview
    step.value = 'importing'
    notice.value = null
    nameError.value = null
    try {
      const done = await createImport({
        ...(upload.value as ImportFile),
        profile_id: current.profile_id,
        statement: current.statement,
        options: options.value as ImportOptions,
        account_id: accountId.value as string,
        lines: selected.value,
        balance: linked.value ? 'keep' : balance.value,
        save_profile: formatSave.value,
      })
      record.value = done
      // With AI set up, the automations have sorted what they could and the AI looks next.
      step.value = done.ai_review_id ? 'ai' : 'done'
      imports.added(done)
      // Saved formats and balances changed too.
      void imports.load()
      void accounts.load()
    } catch (error) {
      step.value = 'review'
      failed(error)
    }
  }

  return {
    step,
    fileName,
    upload,
    preview,
    options,
    edited,
    accountId,
    selected,
    balance,
    save,
    formatName,
    refreshing,
    notice,
    nameError,
    record,
    source,
    statementRows,
    needsAi,
    suggestedAccount,
    skipped,
    statementNotes,
    format,
    account,
    linked,
    selectedTotal,
    profileName,
    canSave,
    formatSave,
    canImport,
    reset,
    cancel,
    start,
    openReading,
    refresh,
    editRow,
    flipSigns,
    changeOptions,
    chooseAccount,
    chooseStatement,
    renameFormat,
    select,
    importRows,
  }
})
