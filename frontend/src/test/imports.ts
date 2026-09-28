import type {
  CsvLayout,
  CsvPreview,
  FileImport,
  ImportOptions,
  ImportPreview,
  PreviewRow,
  SavedFormat,
} from '@/api/imports'
import { useImportsStore } from '@/stores/imports'
import { useImportWizard, type ImportStep } from '@/stores/importWizard'
import { checking } from '@/test/finance'

/** A checking account's CSV export: date, description, amount, balance and the bank's ID. */
export function makeLayout(changes: Partial<CsvLayout> = {}): CsvLayout {
  return {
    delimiter: ',',
    skip_rows: 0,
    header: true,
    columns: {
      date: 0,
      amount: 2,
      money_in: null,
      money_out: null,
      direction: null,
      payee: 1,
      memo: null,
      category: null,
      id: 4,
      balance: 3,
    },
    amounts: 'one',
    money_in_values: [],
    ...changes,
  }
}

export function makeOptions(changes: Partial<ImportOptions> = {}): ImportOptions {
  return {
    date_order: 'mdy',
    decimal_mark: '.',
    flip: false,
    payee_field: 'name',
    csv: makeLayout(),
    ...changes,
  }
}

export function makeRow(changes: Partial<PreviewRow> = {}): PreviewRow {
  return {
    line: 2,
    date: '2026-09-01',
    amount: '1875.00',
    payee: 'NORTHWIND HEALTH PAYROLL PPD',
    description: 'NORTHWIND HEALTH PAYROLL PPD',
    memo: null,
    category_id: null,
    status: 'new',
    problem: null,
    match: null,
    ...changes,
  }
}

/** A new paycheck, groceries already in the account, coffee that might be, and a pending row. */
export const payroll = makeRow()
export const groceriesRow = makeRow({
  line: 3,
  date: '2026-09-02',
  amount: '-84.12',
  payee: 'Whole Foods',
  description: 'WHOLEFDS MKT #10234 AUSTIN TX',
  category_id: 'category-groceries',
  status: 'duplicate',
  match: {
    id: 'transaction-groceries',
    date: '2026-09-02',
    amount: '-84.12',
    payee: 'Whole Foods',
    source: 'manual',
  },
})
export const coffeeRow = makeRow({
  line: 4,
  date: '2026-09-03',
  amount: '-4.50',
  payee: 'BLUE BOTTLE COFFEE',
  description: 'BLUE BOTTLE COFFEE',
  category_id: 'category-coffee',
  status: 'possible_duplicate',
  match: {
    id: 'transaction-latte',
    date: '2026-09-04',
    amount: '-4.50',
    payee: 'Blue Bottle',
    source: 'plaid',
  },
})
export const pendingRow = makeRow({
  line: 5,
  date: null,
  amount: '-19.99',
  payee: null,
  description: 'PENDING - AMAZON MKTP US',
  status: 'invalid',
  problem: 'It has no date.',
})

export function makeCsvPreview(changes: Partial<CsvPreview> = {}): CsvPreview {
  return {
    columns: [
      { index: 0, name: 'Date', samples: ['09/01/2026', '09/02/2026', '09/03/2026'] },
      { index: 1, name: 'Description', samples: ['NORTHWIND HEALTH PAYROLL PPD'] },
      { index: 2, name: 'Amount', samples: ['1875.00', '-84.12', '-4.50'] },
      { index: 3, name: 'Balance', samples: ['2875.00', '2790.88'] },
      { index: 4, name: 'Transaction ID', samples: ['T1001', 'T1002'] },
    ],
    lines: [
      ['Date', 'Description', 'Amount', 'Balance', 'Transaction ID'],
      ['09/01/2026', 'NORTHWIND HEALTH PAYROLL PPD', '1875.00', '2875.00', 'T1001'],
    ],
    missing: [],
    direction_values: [],
    ...changes,
  }
}

/** A CSV file for the checking account, read with a newly detected layout. */
export function makePreview(changes: Partial<ImportPreview> = {}): ImportPreview {
  const rows = changes.rows ?? [payroll, groceriesRow, coffeeRow, pendingRow]
  return {
    format: 'csv',
    file_name: 'harbor-checking.csv',
    options: makeOptions(),
    profile_id: null,
    csv: makeCsvPreview(),
    statements: [],
    statement: 0,
    new_account: { name: null, institution: null, type: null, mask: null, currency: null },
    account_id: checking.id,
    bank_history: null,
    rows,
    summary: {
      rows: rows.length,
      new: rows.filter((row) => row.status === 'new').length,
      duplicates: rows.filter((row) => row.status === 'duplicate').length,
      possible_duplicates: rows.filter((row) => row.status === 'possible_duplicate').length,
      invalid: rows.filter((row) => row.status === 'invalid').length,
      first_date: '2026-09-01',
      last_date: '2026-09-03',
    },
    balance: {
      current: '2450.18',
      closing: '2781.88',
      closing_date: '2026-09-03',
      suggested: 'file',
    },
    ...changes,
  }
}

export function makeImport(changes: Partial<FileImport> = {}): FileImport {
  return {
    id: 'import-checking',
    account_id: checking.id,
    profile_id: 'format-harbor',
    file_name: 'harbor-checking.csv',
    format: 'csv',
    added: 62,
    skipped: 2,
    total: '31390.29',
    balance_change: '0.00',
    first_date: '2025-08-26',
    last_date: '2026-05-28',
    created_at: '2026-05-31T10:00:00Z',
    created_by: 'Alex Rivera',
    ...changes,
  }
}

export const checkingImport = makeImport()
export const savingsImport = makeImport({
  id: 'import-savings',
  account_id: 'account-savings',
  profile_id: null,
  file_name: 'harbor-savings.qfx',
  format: 'ofx',
  added: 19,
  skipped: 0,
  total: '2349.77',
  first_date: '2025-08-29',
  last_date: '2026-05-26',
  created_at: '2026-05-31T11:00:00Z',
})

export function makeFormat(changes: Partial<SavedFormat> = {}): SavedFormat {
  return {
    id: 'format-harbor',
    name: 'Harbor Credit Union checking',
    headers: ['Date', 'Description', 'Amount', 'Balance', 'Transaction ID'],
    options: makeOptions(),
    account_id: checking.id,
    last_used_at: '2026-05-31T10:00:00Z',
    created_at: '2026-05-31T10:00:00Z',
    ...changes,
  }
}

export const harborFormat = makeFormat()
export const mapleFormat = makeFormat({
  id: 'format-maple',
  name: 'Maple store card',
  headers: ['Trans. Date', 'Post Date', 'Description', 'Amount', 'Category'],
  options: makeOptions({ flip: true }),
  account_id: null,
  last_used_at: null,
})

/** Puts imports and saved formats in their store, as if loaded. */
export function seedImports({
  imports = [savingsImport, checkingImport],
  formats = [harborFormat, mapleFormat],
}: { imports?: FileImport[]; formats?: SavedFormat[] } = {}) {
  const store = useImportsStore()
  store.imports = imports
  store.formats = formats
  store.loaded = true
  return store
}

/** The import wizard at `step` with `preview` read, its new rows ticked, as a test starts it. */
export function seedWizard(preview: ImportPreview = makePreview(), step: ImportStep = 'columns') {
  const wizard = useImportWizard()
  wizard.fileName = preview.file_name
  wizard.upload = { file_name: preview.file_name, content: btoa('Date,Amount\n') }
  wizard.preview = preview
  wizard.options = preview.options
  wizard.accountId = preview.account_id
  wizard.selected = preview.rows.filter((row) => row.status === 'new').map((row) => row.line)
  wizard.balance = preview.balance?.suggested ?? 'keep'
  wizard.formatName = 'Harbor Credit Union checking 2'
  wizard.step = step
  return wizard
}

/** A statement file as the file picker gives it. */
export const statementFile = (name = 'harbor-checking.csv') =>
  new File(['Date,Amount\n'], name, { type: 'text/csv' })

/** A deferred answer, to settle when a test says. */
export function later<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}
