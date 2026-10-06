import { MAX_STATEMENT_BYTES } from '@/api/ai'
import { makeStatementRow } from '@/test/ai'
import { isPdf, readPdf, statementDocument } from '@/views/import/statement'

/** What the document says, read back from the base64 the API takes. */
const decoded = (content: string) =>
  JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(content), (c) => c.codePointAt(0) as number)),
  )

describe('PDF statements', () => {
  it('knows a PDF by its type or its name', () => {
    expect(isPdf(new File(['x'], 'september.pdf', { type: 'application/pdf' }))).toBe(true)
    expect(isPdf(new File(['x'], 'SEPTEMBER.PDF'))).toBe(true)
    expect(isPdf(new File(['x'], 'statement', { type: 'application/pdf' }))).toBe(true)
    expect(isPdf(new File(['x'], 'checking.csv', { type: 'text/csv' }))).toBe(false)
    expect(isPdf(new File(['x'], 'pdf.csv'))).toBe(false)
  })

  it('reads a PDF for the API', async () => {
    const file = new File(['%PDF-1.7'], 'september.pdf', { type: 'application/pdf' })

    expect(await readPdf(file)).toEqual({ file_name: 'september.pdf', content: btoa('%PDF-1.7') })
    expect((await readPdf(new File(['x'], ''))).file_name).toBe('statement')
    expect((await readPdf(new File(['x'], `${'a'.repeat(300)}.pdf`))).file_name).toHaveLength(255)
  })

  it('turns down a PDF that is empty or too big to be a statement', async () => {
    await expect(readPdf(new File([], 'empty.pdf'))).rejects.toThrow(
      'empty.pdf is empty. Download it from your bank again.',
    )
    const big = new File(['x'], 'years.pdf')
    Object.defineProperty(big, 'size', { value: MAX_STATEMENT_BYTES + 1 })
    await expect(readPdf(big)).rejects.toThrow(
      'years.pdf is over 10 MB, which is too big for a statement. Download fewer months at a time.',
    )
  })

  it('makes the rows it read into the file the import takes', () => {
    const file = statementDocument('september.pdf', [
      makeStatementRow({ note: 'Check it' }),
      makeStatementRow({ line: 2, date: null, payee: 'Café ☕', amount: null }),
    ])

    expect(file.file_name).toBe('september.pdf')
    // Only what the import reads goes in, however it was written, with any letters in it.
    expect(decoded(file.content)).toEqual({
      format: 'cashcove-statement',
      version: 1,
      rows: [
        { date: '2026-09-02', payee: 'Wholefds Mkt Austin Tx', amount: '-84.12' },
        { date: null, payee: 'Café ☕', amount: null },
      ],
    })
  })
})
