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

/**
 * A PDF with a page for each list of lines, drawn from the top left in Courier, a fixed-width
 * font, so the spaces in a line keep its columns where they are, as in a bank's own PDF. The
 * text is in the file, so it can be read: a page with no lines is a picture, as a scan is.
 */
export function pdfFile(
  name: string,
  pages: readonly (readonly string[])[],
  { fontSize = 8 }: { fontSize?: number } = {},
): StatementFile {
  const escape = (text: string) =>
    text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  // Object 1 is the catalog, 2 the page tree, 3 the font; each page is two more, its page and
  // its content.
  const kids = pages.map((_, index) => `${4 + 2 * index} 0 R`).join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ]
  pages.forEach((lines, index) => {
    const text = lines.map((line) => `(${escape(line)}) Tj T*\n`).join('')
    const content = `BT\n/F1 ${fontSize} Tf\n${fontSize + 3} TL\n36 760 Td\n${text}ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + 2 * index} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    )
  })
  // Everything is ASCII, so a string's length is its length in bytes.
  let file = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(file.length)
    file += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const table = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}`
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${file.indexOf('xref\n')}\n%%EOF\n`
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(file, 'latin1') }
}

/** What a bank prints on a statement besides its transactions: whose it is, and which account. */
export interface PdfStatementAccount {
  /** The bank's name, at the top. */
  bank?: string
  /** The person it's addressed to. */
  holder?: string
  /** The account number, which Cashcove matches to an account by its last digits. */
  number?: string
  address?: string
  /**
   * The days the statement says it covers, counted back from today like a row's `days_ago`:
   * from the earliest to the latest. The rows' own span unless it says otherwise.
   */
  period?: { from: number; to: number }
}

// Where a statement's columns end, in characters from the left.
const DESCRIPTION_AT = 12
const COLUMNS = { withdrawals: 72, deposits: 87, balance: 102 } as const

/** Puts each text at its place on a line, so the columns line up however long the text is. */
function layOut(...parts: readonly (readonly [number, string])[]): string {
  const line = Array.from({ length: COLUMNS.balance + 2 }, () => ' ')
  for (const [at, text] of parts) {
    for (let i = 0; i < text.length; i += 1) line[at + i] = text.charAt(i)
  }
  return line.join('').trimEnd()
}

/** A text that ends at a column, as the money columns of a statement do. */
const endingAt = (end: number, text: string): [number, string] => [end - text.length, text]

const withCommas = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * A bank's PDF statement for a checking account, laid out the way banks lay theirs out: the
 * bank's name, whose it is and the account number at the top, then the transactions in
 * Withdrawals and Deposits columns with a running balance. Everything a person would be wary of
 * sending anywhere is on it, which is what the specs check never leaves Cashcove: the account
 * number, the name, the address, a phone number, and the balances.
 */
export function bankStatementPdf(
  name: string,
  rows: readonly StatementRow[],
  {
    bank = 'Harbor Credit Union',
    holder = 'ALEX RIVERA',
    number = '000123-4410',
    address = '123 Main Street, Springfield IL 62701',
    period,
  }: PdfStatementAccount = {},
): StatementFile {
  const days = rows.map((row) => row.days_ago)
  const from = period?.from ?? Math.max(...days)
  const to = period?.to ?? Math.min(...days)
  const at = (text: string): [number, string] => [58, text]
  let balance = 2875
  const entries = [...rows]
    .sort((a, b) => b.days_ago - a.days_ago)
    .map((row) => {
      const amount = Number(row.amount)
      balance += amount
      const money = endingAt(
        amount < 0 ? COLUMNS.withdrawals : COLUMNS.deposits,
        withCommas(Math.abs(amount)),
      )
      return layOut(
        [0, bankDate(row.days_ago)],
        [DESCRIPTION_AT, row.description],
        money,
        endingAt(COLUMNS.balance, withCommas(balance)),
      )
    })
  const lines = [
    layOut([0, bank], at(`Statement Period ${bankDate(from)} - ${bankDate(to)}`)),
    layOut([0, holder], at(`Account Number: ${number}`)),
    layOut([0, address], at('Customer Service 1-800-555-0100')),
    '',
    'Account Activity',
    layOut(
      [0, 'Date'],
      [DESCRIPTION_AT, 'Description'],
      endingAt(COLUMNS.withdrawals, 'Withdrawals'),
      endingAt(COLUMNS.deposits, 'Deposits'),
      endingAt(COLUMNS.balance, 'Balance'),
    ),
    layOut(
      [0, bankDate(from)],
      [DESCRIPTION_AT, 'Beginning balance'],
      endingAt(COLUMNS.balance, withCommas(2875)),
    ),
    ...entries,
    layOut(
      [0, bankDate(to)],
      [DESCRIPTION_AT, 'Ending balance'],
      endingAt(COLUMNS.balance, withCommas(balance)),
    ),
  ]
  return pdfFile(name, [lines])
}
