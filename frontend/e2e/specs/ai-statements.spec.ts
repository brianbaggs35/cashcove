import {
  AI_KEYS,
  bankDate,
  bankStatementPdf,
  expect,
  holdAi,
  pdfFile,
  setUpAi,
  signInFiles,
  simpleCsv,
  test,
  type StatementFile,
} from '../support'

/**
 * What a bank's PDF statement for the checking account holds: a purchase, a paycheck, a Zelle
 * payment to a person, and a coffee. It also has everything that must stay on this computer: the
 * account number, the name, the address, a phone number and the balances.
 */
const statement = (name = 'harbor-statement.pdf') =>
  bankStatementPdf(name, [
    { days_ago: 12, description: 'WHOLEFDS MKT #10234 AUSTIN TX', amount: '-84.12' },
    { days_ago: 9, description: 'ACME CORP PAYROLL PPD', amount: '2400.00' },
    { days_ago: 7, description: 'ZELLE PAYMENT TO JOHN SMITH 4155551234', amount: '-50.00' },
    { days_ago: 4, description: 'STARBUCKS STORE 1234', amount: '-5.25' },
  ])

/** What the AI is never sent from it. */
const PRIVATE = [
  'JOHN SMITH',
  'John Smith',
  '4155551234',
  '000123-4410',
  '000123',
  'ALEX RIVERA',
  'Alex Rivera',
  '123 Main Street',
  'Springfield',
  '1-800-555-0100',
  'Harbor Credit Union',
  'Everyday checking',
  // Its balances.
  '2,875.00',
  '2,790.88',
  '5,190.88',
  '5,140.88',
  '5,135.63',
]

/** Setting AI up as an admin would, without the second opinion that follows an import. */
const readingAi = (api: Parameters<typeof setUpAi>[0]) =>
  setUpAi(api, 'openai', { reviewImports: false })

test.describe('Reading a PDF statement', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('a PDF given to the chat is read, checked, corrected and imported, and the chat says where it went', async ({
      page,
      aiPage,
      apiAs,
      importPage,
      transactionsPage,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()
      await expect(aiPage.statementOffer).toContainText('Read a bank statement')
      await expect(aiPage.statementOffer).toContainText(
        'Your account numbers, name and address stay on this computer.',
      )

      await aiPage.attachStatement(statement())

      // The conversation has the file, and the AI's reading of it as a card.
      await expect(aiPage.messages.first()).toContainText('harbor-statement.pdf')
      await expect(aiPage.found).toHaveText('Found 4 transactions in harbor-statement.pdf')
      const card = aiPage.statement
      await expect(card.getByTestId('statement-details')).toContainText(
        'Looks like Everyday checking',
      )
      await expect(card.getByTestId('statement-figures')).toContainText('Money in $2,400.00')
      await expect(card.getByTestId('statement-figures')).toContainText('Money out $139.37')
      await expect(card.getByTestId('statement-flagged')).toHaveCount(0)

      // Nothing is added until it's been checked, in the same review as the Import tab's.
      await aiPage.reviewStatement()
      await expect(importPage.steps).toHaveText([/Read by AI/, /Review/, /Import/])
      await expect(importPage.statementNote).toContainText('The AI read these off your PDF.')
      const account = importPage.dialog.getByTestId('review-account')
      await expect(account).toContainText('Everyday checking')
      await expect(account).toContainText(
        'Matched from the last digits on the statement, here on this computer.',
      )
      await expect(importPage.reviewRows).toHaveCount(4)
      await expect(importPage.row('Wholefds Mkt')).toContainText('-$84.12')
      await expect(importPage.row('Acme Corp Payroll')).toContainText('+$2,400.00')
      await expect(importPage.statementSkipped).toHaveCount(0)

      // The AI never knew who the Zelle payment was to, since it's hidden from it; you do.
      await importPage.editRow('Zelle Payment To', { who: 'Zelle to Jamie, birthday' })
      await expect(importPage.row('Zelle to Jamie, birthday')).toContainText('-$50.00')
      await importPage.tick(['Starbucks'], { on: false })
      await expect(importPage.dialog.getByTestId('import-submit')).toHaveText(
        'Import 3 transactions',
      )

      await importPage.importRows()
      await expect(importPage.dialog.getByTestId('import-done')).toContainText('3 transactions')
      await importPage.close()

      // The chat says what became of it, and links to what it added.
      const imported = card.getByTestId('statement-imported')
      await expect(imported).toContainText('Imported 3 transactions into Everyday checking.')
      await expect(card.getByTestId('statement-review')).toHaveCount(0)
      await card.getByTestId('statement-see').click()
      await expect(page).toHaveURL(/\/transactions\?import=/)
      await expect(transactionsPage.chips).toContainText('From harbor-statement.pdf')
      await expect(transactionsPage.rows).toHaveCount(3)
      await expect(transactionsPage.row('Zelle to Jamie, birthday')).toContainText('50.00')
      await expect(transactionsPage.row('Acme Corp Payroll')).toContainText('2,400.00')
      await expect(transactionsPage.row(/starbucks/i)).toHaveCount(0)
    })

    test('the chat says it is reading while the AI works, and the reading can be stopped and started again', async ({
      page,
      aiPage,
      apiAs,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()
      const reading = await holdAi(page, 'statements')

      await page.getByTestId('chat-file').setInputFiles(statement())

      // The AI is working, and the conversation says so, and what is kept from it.
      const card = aiPage.statement
      await expect(card).toHaveAttribute('data-status', 'reading')
      await expect(card.getByTestId('statement-progress')).toContainText(
        'Reading harbor-statement.pdf',
      )
      await expect(card.getByTestId('statement-stage')).toContainText(
        'Taking the transactions off the statement',
      )
      await expect(card.getByTestId('statement-privacy')).toContainText(
        'Only its transaction lines go to GPT-6 Luna, with names, numbers and addresses hidden.',
      )
      // Where a question has dots, a statement has its own say, not both.
      await expect(aiPage.busy).toHaveCount(0)
      await expect(aiPage.attach).toBeDisabled()
      await expect(aiPage.send).toBeDisabled()

      // Stopping it frees the chat, and a question can be asked meanwhile.
      await card.getByTestId('statement-cancel').click()
      await expect(card).toHaveAttribute('data-status', 'cancelled')
      await expect(card.getByTestId('statement-stopped')).toHaveText(
        'Stopped reading harbor-statement.pdf.',
      )
      await aiPage.ask('How much did I spend on coffee?')
      await expect(aiPage.messages.last()).toContainText(
        'You asked: How much did I spend on coffee?',
      )

      // The reading that was stopped is ignored when it finishes.
      const finished = page.waitForResponse('**/api/ai/statements')
      reading.release()
      await (await finished).finished()
      await expect(card).toHaveAttribute('data-status', 'cancelled')

      await card.getByTestId('statement-reread').click()
      await expect(card).toHaveAttribute('data-status', 'done')
      await expect(aiPage.found).toHaveText('Found 4 transactions in harbor-statement.pdf')
    })

    test('a PDF can be dropped on the conversation, which says where to drop it', async ({
      aiPage,
      apiAs,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()

      await aiPage.dropStatement(statement())

      await expect(aiPage.found).toHaveText('Found 4 transactions in harbor-statement.pdf')
      await expect(aiPage.dropTarget).toHaveCount(0)
    })

    test('a PDF chosen on the Import tab is read the same way, and the AI looks over how it was sorted', async ({
      apiAs,
      importPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await importPage.goto()

      await importPage.chooseFile(statement())

      // Reading by the AI is the first step, and its second opinion is the last.
      await expect(importPage.steps).toHaveText([
        /Read by AI/,
        /Review/,
        /Import/,
        /AI second opinion/,
      ])
      await expect(importPage.statementNote).toBeVisible()
      await expect(importPage.dialog.getByTestId('review-account')).toContainText(
        'Everyday checking',
      )
      await expect(importPage.reviewRows).toHaveCount(4)

      await importPage.importRowsForAi()

      // What the AI makes of the coffee, which it can't know the rest of the account for.
      await expect(importPage.aiSuggestions).toHaveCount(1)
      await expect(importPage.aiSuggestion(/starbucks/i)).toContainText('Coffee')
    })

    test('a possible duplicate in a PDF statement starts unticked and is left out', async ({
      apiAs,
      baseline,
      importPage,
      transactionsPage,
    }) => {
      await readingAi(await apiAs('admin'))
      await importPage.goto()
      await importPage.chooseFile(
        bankStatementPdf('harbor-overlap.pdf', [
          {
            days_ago: baseline.transactions.groceries.days_ago,
            description: 'WHOLEFDS MKT #10234 AUSTIN TX',
            amount: '-84.12',
          },
          { days_ago: 1, description: 'LOCAL BOOKSHOP PURCHASE', amount: '-11.23' },
        ]),
      )

      const duplicate = importPage.row('Wholefds Mkt')
      await expect(duplicate).toContainText('Possible duplicate: Whole Foods')
      await expect(
        duplicate.getByTestId('review-row-check').getByRole('checkbox'),
      ).not.toBeChecked()
      await expect(importPage.dialog.getByTestId('import-submit')).toHaveText(
        'Import 1 transaction',
      )

      await importPage.importRows()
      await importPage.seeTransactions()
      await expect(transactionsPage.rows).toHaveCount(1)
    })

    test('a statement’s rows can be flipped when the money went the wrong way, and its account changed', async ({
      aiPage,
      apiAs,
      importPage,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()
      await aiPage.attachStatement(statement())
      await aiPage.reviewStatement()
      await expect(importPage.row('Wholefds Mkt')).toContainText('-$84.12')
      await expect(importPage.row('Acme Corp Payroll')).toContainText('+$2,400.00')

      await importPage.flipMoney()

      await expect(importPage.row('Wholefds Mkt')).toContainText('+$84.12')
      await expect(importPage.row('Acme Corp Payroll')).toContainText('-$2,400.00')
      await importPage.flipMoney()
      await expect(importPage.row('Wholefds Mkt')).toContainText('-$84.12')

      // Which account is the person's to say; the match was a help.
      await importPage.chooseAccount('Rainy day fund')
      await expect(importPage.dialog.getByTestId('review-account')).not.toContainText(
        'Matched from the last digits',
      )
      await importPage.tick(['Wholefds', 'Zelle', 'Starbucks'], { on: false })
      await importPage.importRows()
      await importPage.close()

      await expect(aiPage.statement.getByTestId('statement-imported')).toContainText(
        'Imported 1 transaction into Rainy day fund.',
      )
    })

    test('says which rows need a look, and mending one takes it off the list', async ({
      aiPage,
      apiAs,
      importPage,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()
      // A statement of the last two weeks with a payment dated a year ago.
      const odd = bankStatementPdf(
        'odd-dates.pdf',
        [
          { days_ago: 10, description: 'WHOLEFDS MKT #10234 AUSTIN TX', amount: '-84.12' },
          { days_ago: 400, description: 'DELTA AIR LINES', amount: '-486.20' },
          { days_ago: 3, description: 'ACME CORP PAYROLL PPD', amount: '2400.00' },
        ],
        { period: { from: 14, to: 1 } },
      )

      await aiPage.attachStatement(odd)

      await expect(aiPage.statement.getByTestId('statement-flagged')).toHaveText('1 needs a look')
      await aiPage.reviewStatement()
      await expect(importPage.row('Delta Air Lines').getByTestId('review-row-flag')).toContainText(
        "The date is outside the statement's dates.",
      )
      await importPage.showRows('Needs a look')
      await expect(importPage.reviewRows).toHaveCount(1)

      await importPage.editRow('Delta Air Lines', { date: bankDate(6) })

      // Nothing is left to look at, so it's no longer a way to filter the rows.
      await expect(importPage.reviewRows).toHaveCount(3)
      await expect(
        importPage.dialog.getByTestId('review-filters').getByText('Needs a look'),
      ).toHaveCount(0)
      await expect(importPage.dialog.getByTestId('review-row-flag')).toHaveCount(0)
    })

    test('says why a PDF can’t be read, and sends nothing to the AI when there is nothing to read', async ({
      aiPage,
      apiAs,
      harness,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()

      // A scan is a picture: there's no text in it, and sending it would send the account number.
      await aiPage.attachStatement(pdfFile('scan.pdf', [[]]))
      await expect(aiPage.statement.getByTestId('statement-error')).toContainText(
        "There's no text in this PDF: it's a picture of a statement.",
      )

      await aiPage.attachStatement(
        pdfFile('letter.pdf', [['Dear customer,', 'Your statement is ready to view online.']]),
      )
      await expect(aiPage.statement.getByTestId('statement-error')).toContainText(
        "couldn't find any transactions in this PDF",
      )

      await aiPage.attachStatement({
        name: 'notes.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('Just some notes, not a PDF.'),
      })
      await expect(aiPage.statement.getByTestId('statement-error')).toContainText(
        "That isn't a PDF file.",
      )

      // It can be tried again, and nothing was sent to a provider along the way.
      await expect(aiPage.statement.getByTestId('statement-reread')).toBeVisible()
      expect(await harness.aiRequests()).toEqual([])
    })

    test('says to use the Import tab for a file that isn’t a PDF', async ({
      page,
      aiPage,
      apiAs,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()
      const csv: StatementFile = simpleCsv('checking.csv', [
        { days_ago: 2, description: 'LA TAQUERIA', amount: '-23.80' },
      ])

      await page.getByTestId('chat-file').setInputFiles(csv)

      await expect(aiPage.attachProblem).toContainText(
        'Only a PDF statement can be read here. A CSV, OFX, QFX or QIF file goes through the Import tab.',
      )
      await expect(aiPage.statementCards).toHaveCount(0)
      await aiPage.attachProblem.getByTestId('chat-attach-import').click()
      await expect(page).toHaveURL(/\/import$/)
    })

    test('nothing sent to the AI from a statement has an account number, a name, an address or a balance in it', async ({
      aiPage,
      apiAs,
      baseline,
      harness,
    }) => {
      await readingAi(await apiAs('admin'))
      await aiPage.goto()

      await aiPage.attachStatement(statement())
      await expect(aiPage.found).toHaveText('Found 4 transactions in harbor-statement.pdf')

      const requests = await harness.aiRequests()
      expect(requests).toHaveLength(1)
      const sent = requests[0]!.body
      // It was asked about what the transactions are...
      expect(sent).toContain('WHOLEFDS MKT')
      expect(sent).toContain('ACME CORP PAYROLL')
      expect(sent).toContain('STARBUCKS')
      // ...and was told whether each was money in or out, from the columns, here.
      expect(sent).toMatch(/84\.12 \(out\)/)
      expect(sent).toMatch(/2,400\.00 \(in\)/)
      // ...and nothing that says whose it is, which account or bank, or what's in it.
      for (const text of PRIVATE) expect(sent, `${text} was sent`).not.toContain(text)
      for (const account of Object.values(baseline.accounts)) {
        expect(sent, `${account.name} was sent`).not.toContain(account.name)
        expect(sent, `${account.institution} was sent`).not.toContain(account.institution)
      }
      expect(sent).not.toContain('harbor-statement.pdf')
      expect(sent).not.toContain(AI_KEYS.openai)
    })
  })

  test.describe('without AI', () => {
    test.use({ storageState: signInFiles.admin })

    test('the AI tab says reading a statement can only be done with AI, and nothing else needs it', async ({
      aiPage,
    }) => {
      await aiPage.goto()

      await expect(aiPage.setup).toContainText('Read a PDF statement')
      await expect(aiPage.setup.getByText('Needs AI')).toHaveCount(5)
      await expect(aiPage.setup.getByTestId('ai-setup-needs')).toHaveText(
        'These can only be used with AI.',
      )
      await expect(aiPage.statementOffer).toHaveCount(0)
      await expect(aiPage.attach).toHaveCount(0)
    })

    test('a PDF chosen on the Import tab says it needs AI, sends nothing anywhere, and offers to set it up', async ({
      page,
      harness,
      importPage,
    }) => {
      await importPage.goto()
      await expect(page.getByTestId('file-format-pdf')).toHaveText('PDF, read by AI')

      await importPage.chooseFile(statement())

      await expect(
        importPage.dialog.getByRole('heading', { name: 'Reading a PDF needs AI' }),
      ).toBeVisible()
      await expect(importPage.notice).toContainText(
        'Reading a PDF statement can only be done with AI.',
      )
      await expect(importPage.dialog.getByTestId('import-failed')).toContainText(
        'AI is optional, and Cashcove works the same without it.',
      )
      expect(await harness.aiRequests()).toEqual([])

      await importPage.dialog.getByTestId('import-set-up-ai').click()
      await expect(page).toHaveURL(/\/settings\/ai$/)
    })

    test('a file Cashcove reads itself imports as it always did', async ({
      importPage,
      transactionsPage,
    }) => {
      await importPage.goto()
      await importPage.chooseFile(
        simpleCsv('taqueria.csv', [{ days_ago: 2, description: 'LA TAQUERIA', amount: '-23.80' }]),
      )
      await expect(importPage.steps).toHaveText([/Match columns/, /Review/, /Import/])
      await importPage.continue()
      await importPage.chooseAccount('Everyday checking')
      await importPage.importRows()
      await importPage.close()

      await transactionsPage.goto({ q: 'taqueria' })
      await expect(transactionsPage.row('LA TAQUERIA')).toBeVisible()
    })
  })
})
