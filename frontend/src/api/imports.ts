import type { AccountType } from '@/api/accounts'
import { apiDelete, apiGet, apiPatch, apiPost, apiRequest } from '@/api/client'
import type { BulkResult, TransactionSource } from '@/api/transactions'

/** OFX covers QFX and QBO files, which are OFX too. */
export type FileFormat = 'csv' | 'ofx' | 'qif'
/** Which way round a date's numbers go: 2026-09-26, 09/26/2026 or 26/09/2026. */
export type DateOrder = 'ymd' | 'mdy' | 'dmy'
export type DecimalMark = '.' | ','
export type Delimiter = ',' | ';' | '\t' | '|'
/**
 * How a CSV file gives amounts: in one column, in separate columns for money in and money out,
 * or in one column beside another that says which way the money went ("Debit", "CR").
 */
export type AmountColumns = 'one' | 'split' | 'direction'
/** Where an OFX or QIF transaction's payee comes from. */
export type PayeeField = 'name' | 'memo'
/**
 * What importing does to the account's balance: set it to the balance the file ends on, move it
 * by what's imported, or leave it alone because it already counts them.
 */
export type BalanceChoice = 'file' | 'move' | 'keep'
export type RowStatus = 'new' | 'duplicate' | 'possible_duplicate' | 'invalid'
export type NeededField = 'date' | 'amount'

/** Which column holds what, counted from 0. Columns left out aren't in the file. */
export interface CsvColumns {
  date: number | null
  amount: number | null
  money_in: number | null
  money_out: number | null
  /** Says which way an amount went, like "Debit" and "Credit". */
  direction: number | null
  payee: number | null
  memo: number | null
  category: number | null
  /** The bank's own ID for each transaction, which keeps it from being imported twice. */
  id: number | null
  /** The balance after each transaction. */
  balance: number | null
}

export type ColumnField = keyof CsvColumns

export interface CsvLayout {
  delimiter: Delimiter
  /** Lines before the column names, or before the first transaction when there are none. */
  skip_rows: number
  /** Whether the first line after those holds the column names. */
  header: boolean
  columns: CsvColumns
  amounts: AmountColumns
  /** With a direction column, the values in it that mean money came in, whatever their case. */
  money_in_values: string[]
}

export interface ImportOptions {
  date_order: DateOrder
  decimal_mark: DecimalMark
  /** The file's amounts are positive for money going out, as many card exports have them. */
  flip: boolean
  payee_field: PayeeField
  /** Only for CSV files. */
  csv: CsvLayout | null
}

/** A transaction already in the account that a row of the file seems to repeat. */
export interface ImportMatch {
  id: string
  date: string
  amount: string
  payee: string
  source: TransactionSource
}

/** What the household's automations will do to a row when it is imported. */
export interface AutomationEffect {
  category_id: string | null
  /** The subscription or bill its payment will be linked to. */
  subscription_id: string | null
}

export interface PreviewRow {
  /** Where it is in the file, counted from 1, as a spreadsheet numbers rows. */
  line: number
  date: string | null
  amount: string | null
  /** What the transaction will be called: the file's description, or a name learned before. */
  payee: string | null
  description: string | null
  memo: string | null
  /** What it will be filed under: an automation's category when one gives it. */
  category_id: string | null
  status: RowStatus
  /** Why it can't be imported. */
  problem: string | null
  match: ImportMatch | null
  /** Set when automations will sort it as it is imported. */
  automation: AutomationEffect | null
}

export interface CsvColumn {
  index: number
  /** The column's name in the file, or "Column 3" when the file doesn't name its columns. */
  name: string
  samples: string[]
}

export interface CsvPreview {
  columns: CsvColumn[]
  /** The file's first lines, split into cells. */
  lines: string[][]
  /** What no column has been chosen for yet, which the file needs to be read. */
  missing: NeededField[]
  /** What the direction column says, as the file writes it, for choosing which mean money in. */
  direction_values: string[]
}

/** One account's statement, in a file that has several. */
export interface ImportStatement {
  index: number
  name: string | null
  institution: string | null
  type: AccountType | null
  mask: string | null
  currency: string | null
  count: number
}

/** What the file says about its account, for adding it as a new one. */
export interface AccountSuggestion {
  name: string | null
  institution: string | null
  type: AccountType | null
  mask: string | null
  currency: string | null
}

export interface ImportBalance {
  current: string
  /** The balance the file ends on, and its day, for files that have one. */
  closing: string | null
  closing_date: string | null
  suggested: BalanceChoice
}

/**
 * The days of an account's transactions that came from its bank through Plaid. A file fills in
 * the account's history before them, and after them once the bank stopped.
 */
export interface BankHistory {
  start: string
  /** Null while the bank still keeps the account up to date. */
  end: string | null
}

export interface ImportSummary {
  rows: number
  new: number
  duplicates: number
  possible_duplicates: number
  invalid: number
  first_date: string | null
  last_date: string | null
  /** How many of the new rows automations will sort. */
  sorted: number
}

export interface ImportPreview {
  format: FileFormat
  file_name: string
  /** How the file was read, to change and send back. */
  options: ImportOptions
  /** The saved format it was read with. */
  profile_id: string | null
  csv: CsvPreview | null
  statements: ImportStatement[]
  statement: number
  new_account: AccountSuggestion
  /** The account the rows were compared with: the one asked for, or the likeliest one. */
  account_id: string | null
  bank_history: BankHistory | null
  rows: PreviewRow[]
  summary: ImportSummary
  balance: ImportBalance | null
}

/** A statement file, as the API takes it. */
export interface ImportFile {
  file_name: string
  /** The file itself, base64-encoded. */
  content: string
}

export interface PreviewRequest extends ImportFile {
  profile_id?: string | null
  statement?: number
  options?: ImportOptions | null
  account_id?: string | null
}

export interface ImportRequest extends ImportFile {
  profile_id: string | null
  statement: number
  options: ImportOptions
  account_id: string
  /** The preview's line numbers for the rows to import. */
  lines: number[]
  balance: BalanceChoice
  /** Saves how the file was read: a new format, or an update to the one with `id`. */
  save_profile: { id: string | null; name: string } | null
}

export interface FileImport {
  id: string
  account_id: string
  profile_id: string | null
  file_name: string
  format: FileFormat
  added: number
  skipped: number
  total: string
  balance_change: string
  first_date: string
  last_date: string
  created_at: string
  /** Who imported it, by name. */
  created_by: string | null
  /** How many of what it added the household's automations sorted, when it was imported. */
  sorted: number
}

/** A CSV layout saved for a bank's files, which the next file with its columns is read with. */
export interface SavedFormat {
  id: string
  name: string
  headers: string[]
  options: ImportOptions
  /** The account it was last used for. */
  account_id: string | null
  last_used_at: string | null
  created_at: string
}

/** Files are small: a year of a busy card is a few hundred kilobytes. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

export const previewImport = (request: PreviewRequest) =>
  apiPost<ImportPreview>('/imports/preview', request)
export const createImport = (request: ImportRequest) => apiPost<FileImport>('/imports', request)
export const fetchImports = () => apiGet<FileImport[]>('/imports')
/** Deletes what an import added and puts the balance back; says how many it deleted. */
export const undoImport = (id: string) => apiRequest<BulkResult>('DELETE', `/imports/${id}`)
export const fetchSavedFormats = () => apiGet<SavedFormat[]>('/imports/profiles')
export const renameSavedFormat = (id: string, name: string) =>
  apiPatch<SavedFormat>(`/imports/profiles/${id}`, { name })
export const deleteSavedFormat = (id: string) => apiDelete(`/imports/profiles/${id}`)
