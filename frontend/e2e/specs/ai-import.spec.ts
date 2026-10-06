import { expect, setUpAi, signInFiles, simpleCsv, test } from '../support'

/** Two payments the test server's stand-in for the AI knows a category for, and a paycheck. */
const statement = () =>
  simpleCsv('coffee-and-rides.csv', [
    { days_ago: 2, description: 'STARBUCKS STORE 1234', amount: '-5.25' },
    { days_ago: 3, description: 'UBER *TRIP HELP.UBER.COM', amount: '-18.40' },
    { days_ago: 4, description: 'NORTHWIND HEALTH PAYROLL PPD', amount: '1875.00' },
  ])

test.describe('The AI’s second opinion on an import', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an import ends with the AI looking over how the rows were sorted, and what it suggests can be applied', async ({
    apiAs,
    baseline,
    harness,
    importPage,
    transactionsPage,
  }) => {
    await setUpAi(await apiAs('admin'))
    await importPage.goto()
    await importPage.chooseFile(statement())

    // The AI is a last step, after the automations have sorted the rows as they came in.
    await expect(importPage.steps).toHaveText([
      /Match columns/,
      /Review/,
      /Import/,
      /AI second opinion/,
    ])
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await expect(importPage.dialog.getByTestId('import-ai-note')).toContainText(
      'After the import, the AI gives a second opinion on how these were sorted. It only suggests.',
    )

    await importPage.importRowsForAi()

    await expect(
      importPage.dialog.getByRole('heading', { name: 'AI second opinion' }),
    ).toBeVisible()
    await expect(importPage.dialog.getByTestId('import-ai-notes')).toContainText(
      'Imported 3 transactions',
    )
    // The coffee and the ride are the ones it has a view on; the paycheck was sorted well.
    await expect(importPage.aiSuggestions).toHaveCount(2)
    await expect(importPage.aiSuggestion(/starbucks/i)).toContainText('Coffee')
    await expect(importPage.aiSuggestion(/uber/i)).toContainText('Rideshare & taxis')
    await expect(importPage.dialog.getByTestId('import-ai-summary')).toContainText(
      'The AI has 2 suggestions for how these were sorted.',
    )

    await importPage.dialog.getByTestId('import-ai-apply-all').click()
    await expect(importPage.aiDecided).toBeVisible()
    await importPage.close()

    // Applied: the transactions the import added are in the categories it suggested.
    await transactionsPage.goto({ q: 'starbucks' })
    await expect(transactionsPage.row(/starbucks/i)).toContainText('Coffee')
    await transactionsPage.goto({ q: 'uber' })
    await expect(transactionsPage.row(/uber/i)).toContainText('Rideshare & taxis')

    // Nothing that says which account or bank went to the AI.
    const account = baseline.accounts.checking
    const sent = (await harness.aiRequests()).map((request) => request.body).join('\n')
    expect(sent).toMatch(/starbucks/i)
    expect(sent).not.toContain(account.name)
    expect(sent).not.toContain(account.institution)
    expect(sent).not.toMatch(new RegExp(`(?<!\\d)${account.mask}(?!\\d)`))
    expect(sent).not.toContain('coffee-and-rides.csv')
  })

  test('suggestions that are left alone wait on the AI tab, with the import they came from', async ({
    aiPage,
    apiAs,
    importPage,
  }) => {
    await setUpAi(await apiAs('admin'))
    await importPage.goto()
    await importPage.chooseFile(statement())
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await importPage.importRowsForAi()

    await importPage.close()

    await aiPage.goto('recommendations')
    await expect(aiPage.tile('open')).toContainText('2')
    await expect(aiPage.waiting).toContainText('2')
    await expect(aiPage.history.first()).toContainText('Import of coffee-and-rides.csv')
    await expect(aiPage.suggestions).toHaveCount(2)
  })

  test('a file the AI agrees with is told so', async ({ apiAs, importPage }) => {
    await setUpAi(await apiAs('admin'))
    await importPage.goto()
    await importPage.chooseFile(
      simpleCsv('paycheck.csv', [
        { days_ago: 4, description: 'NORTHWIND HEALTH PAYROLL PPD', amount: '1875.00' },
      ]),
    )
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')

    await importPage.importRowsForAi()

    await expect(importPage.aiAgrees).toContainText(
      'The AI agrees with how that transaction was sorted.',
    )
  })

  test('with the second opinion turned off in Settings, an import ends where it always did', async ({
    apiAs,
    harness,
    importPage,
  }) => {
    await setUpAi(await apiAs('admin'), 'openai', { reviewImports: false })
    await importPage.goto()
    await importPage.chooseFile(statement())
    await expect(importPage.steps).toHaveCount(3)
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await expect(importPage.dialog.getByTestId('import-ai-note')).toHaveCount(0)

    await importPage.importRows()

    await expect(importPage.aiStep).toHaveCount(0)
    expect(await harness.aiRequests()).toEqual([])
  })

  test('without AI, an import has the steps it always had', async ({ importPage, harness }) => {
    await importPage.goto()
    await importPage.chooseFile(statement())
    await expect(importPage.steps).toHaveText([/Match columns/, /Review/, /Import/])
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')

    await importPage.importRows()

    await expect(importPage.aiStep).toHaveCount(0)
    expect(await harness.aiRequests()).toEqual([])
  })
})
