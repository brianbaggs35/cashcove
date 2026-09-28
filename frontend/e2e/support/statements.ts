/**
 * Statement files for the Import tab, made up by a test, with dates counted back from today
 * like the baseline's. Hand one to `importPage.chooseFile(file)`.
 */

/** A file, as the file picker gives it to the page. */
export interface StatementFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/** A transaction on a statement. */
export interface StatementRow {
  /** How many days before today it happened, like the baseline's `days_ago`. */
  days_ago: number
  /** What the bank calls it, e.g. `'WHOLEFDS MKT #10234'`. */
  description: string
  /** As Cashcove shows it: `'-84.12'` is money out. */
  amount: string
  /** The bank's own ID for it, which keeps it from coming in twice. */
  id?: string
}

export type DateOrder = 'mdy' | 'dmy' | 'ymd'

function daysAgo(days: number): Date {
  const day = new Date()
  day.setUTCDate(day.getUTCDate() - days)
  return day
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A day counted back from today, the way banks write it: `'09/25/2026'` month first (US),
 * `'25/09/2026'` day first, or `'2026-09-25'` year first.
 */
export function bankDate(days: number, order: DateOrder = 'mdy'): string {
  const day = daysAgo(days)
  const year = String(day.getUTCFullYear())
  const month = pad(day.getUTCMonth() + 1)
  const date = pad(day.getUTCDate())
  if (order === 'ymd') return `${year}-${month}-${date}`
  return order === 'dmy' ? `${date}/${month}/${year}` : `${month}/${date}/${year}`
}

/** A cell as CSV writes it, in quotes when it holds a comma, a quote or a line break. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * A CSV file with these column names, or none when `header` is null, and these rows, as they
 * appear in the file. Most banks' exports are like this, each with columns of its own.
 */
export function csvFile(
  name: string,
  header: readonly string[] | null,
  rows: readonly (readonly string[])[],
): StatementFile {
  const lines = (header ? [header, ...rows] : rows).map((row) => row.map(csvCell).join(','))
  return { name, mimeType: 'text/csv', buffer: Buffer.from(`${lines.join('\n')}\n`) }
}

/** The simplest bank export: Date, Description and Amount columns, dates month first. */
export function simpleCsv(name: string, rows: readonly StatementRow[]): StatementFile {
  return csvFile(
    name,
    ['Date', 'Description', 'Amount'],
    rows.map((row) => [bankDate(row.days_ago), row.description, row.amount]),
  )
}

export interface OfxAccount {
  /** A checking or savings account's statement, or a card's. */
  type?: 'checking' | 'savings' | 'credit_card'
  /** The account number; Cashcove matches its last four to an account's. */
  number?: string
  /** The bank's name, which the file gives. */
  bank?: string
  /** The balance on the statement's last day, e.g. `'-1204.11'` for a card with that owed. */
  balance?: string
}

const ofxDate = (days: number) => bankDate(days, 'ymd').replaceAll('-', '')

/**
 * An OFX statement for one account, which is what QFX and QBO downloads hold too: name it
 * `.qfx` or `.qbo` to have the Import tab call it that.
 */
export function ofxFile(
  name: string,
  rows: readonly StatementRow[],
  {
    type = 'checking',
    number = '000123454410',
    bank = 'Harbor Credit Union',
    balance,
  }: OfxAccount = {},
): StatementFile {
  const days = rows.map((row) => row.days_ago)
  const [first, last] = [Math.max(...days), Math.min(...days)]
  const transactions = rows.map((row, index) =>
    [
      '<STMTTRN>',
      `<TRNTYPE>${row.amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}</TRNTYPE>`,
      `<DTPOSTED>${ofxDate(row.days_ago)}</DTPOSTED>`,
      `<TRNAMT>${row.amount}</TRNAMT>`,
      `<FITID>${row.id ?? `T${index + 1}`}</FITID>`,
      `<NAME>${row.description.replaceAll('&', '&amp;')}</NAME>`,
      '</STMTTRN>',
    ].join(''),
  )
  const card = type === 'credit_card'
  const from = card
    ? `<CCACCTFROM><ACCTID>${number}</ACCTID></CCACCTFROM>`
    : `<BANKACCTFROM><BANKID>121000358</BANKID><ACCTID>${number}</ACCTID><ACCTTYPE>${type.toUpperCase()}</ACCTTYPE></BANKACCTFROM>`
  const statement = [
    '<CURDEF>USD</CURDEF>',
    from,
    `<BANKTRANLIST><DTSTART>${ofxDate(first)}</DTSTART><DTEND>${ofxDate(last)}</DTEND>`,
    ...transactions,
    '</BANKTRANLIST>',
    balance
      ? `<LEDGERBAL><BALAMT>${balance}</BALAMT><DTASOF>${ofxDate(last)}</DTASOF></LEDGERBAL>`
      : '',
  ].join('\n')
  const status = '<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>'
  const body = card
    ? `<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>1</TRNUID>${status}<CCSTMTRS>${statement}</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>`
    : `<BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID>${status}<STMTRS>${statement}</STMTRS></STMTTRNRS></BANKMSGSRSV1>`
  const text = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
    `<OFX><SIGNONMSGSRSV1><SONRS>${status}<DTSERVER>${ofxDate(0)}</DTSERVER><LANGUAGE>ENG</LANGUAGE><FI><ORG>${bank.replaceAll('&', '&amp;')}</ORG><FID>1001</FID></FI></SONRS></SIGNONMSGSRSV1>`,
    body,
    '</OFX>',
  ].join('\n')
  return { name, mimeType: 'application/x-ofx', buffer: Buffer.from(`${text}\n`) }
}

/** A QIF file, as Quicken and some banks export, for a bank account or a card (`'CCard'`). */
export function qifFile(
  name: string,
  rows: readonly StatementRow[],
  { type = 'Bank' }: { type?: 'Bank' | 'CCard' } = {},
): StatementFile {
  const lines = [`!Type:${type}`]
  for (const row of rows) {
    lines.push(`D${bankDate(row.days_ago)}`, `T${row.amount}`, `P${row.description}`, '^')
  }
  return { name, mimeType: 'application/qif', buffer: Buffer.from(`${lines.join('\n')}\n`) }
}
