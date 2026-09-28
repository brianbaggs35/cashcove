import { expect, signInFiles, test } from '../support'

test.describe('Connecting banks', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin connects a bank and chooses which accounts to import', async ({
    page,
    connectPage,
    transactionsPage,
    plaid,
  }) => {
    await connectPage.goto()
    await connectPage.startConnecting({ history: 'Last 90 days' })
    await plaid.connect('platypus')

    await expect(connectPage.accountRows).toHaveCount(3)
    await connectPage.renameAccount('Plaid Checking', 'Joint checking')
    await connectPage.chooseAccounts('Joint checking', 'Plaid Credit Card')
    await connectPage.importAccounts()

    await expect(connectPage.wizard.getByTestId('connect-done')).toContainText(
      '2 accounts imported',
    )
    await connectPage.finish()
    await expect(connectPage.account('First Platypus Bank', 'Joint checking')).toContainText(
      'Imported',
    )
    await expect(connectPage.account('First Platypus Bank', 'Plaid Saving')).toContainText(
      'Not imported',
    )

    await connectPage.account('First Platypus Bank', 'Joint checking').click()
    await expect(page).toHaveURL(/\/transactions\?account=/)
    await expect(transactionsPage.row('Acme Corp Payroll').first()).toContainText('2,450.00')
  })

  test('a bank that signs people in on its own website comes back to finish', async ({
    page,
    connectPage,
    plaid,
  }) => {
    await connectPage.goto()
    await connectPage.startConnecting()
    await plaid.connect('gingham', { onBankWebsite: true })

    await expect(connectPage.accountRows).toHaveCount(3)
    await expect(page).toHaveURL(/\/connect$/)
    await connectPage.chooseAccounts('Plaid Saving')
    await connectPage.importAccounts()
    await connectPage.finish()

    await expect(connectPage.card('First Gingham Credit Union')).toBeVisible()
  })

  test('closing Plaid, or Plaid failing, connects nothing', async ({ connectPage, plaid }) => {
    await connectPage.goto()
    await connectPage.startConnecting()
    await plaid.close()
    await expect(connectPage.wizard.getByTestId('connect-notice')).toContainText(
      'Plaid closed before a bank was connected.',
    )

    await connectPage.wizard.getByTestId('connect-continue').click()
    await plaid.fail()
    await expect(connectPage.wizard.getByTestId('connect-notice')).toContainText(
      'not currently responding',
    )
    await connectPage.wizard.getByTestId('connect-cancel').click()
    await expect(connectPage.cards).toHaveCount(2)
  })

  test('the next sync brings in what the bank reports', async ({
    baseline,
    connectPage,
    transactionsPage,
    plaid,
  }) => {
    await plaid.addTransaction({
      account_id: baseline.accounts.card.id,
      amount: '-23.45',
      payee: 'Corner Bakery',
      category: 'FOOD_AND_DRINK_RESTAURANT',
    })

    await connectPage.goto()
    await connectPage.syncNow('Tartan Bank')

    await expect(connectPage.card('Tartan Bank').getByTestId('connection-last-sync')).toContainText(
      '1 new transaction',
    )
    await transactionsPage.goto()
    await expect(transactionsPage.row('Corner Bakery')).toContainText('23.45')
  })

  test('an admin reconnects a bank that wants a new sign-in', async ({ connectPage, plaid }) => {
    await connectPage.goto()
    await expect(connectPage.status('Fidelity')).toHaveText('Sign-in needed')

    await connectPage.card('Fidelity').getByTestId('connection-problem-reconnect').click()
    await plaid.signInAgain()

    await expect(connectPage.status('Fidelity')).toHaveText('Up to date')
  })

  test('a bank that fails its syncs asks to be reconnected', async ({
    baseline,
    connectPage,
    plaid,
  }) => {
    await plaid.failSyncs(baseline.connections.tartan.id, 'ITEM_LOGIN_REQUIRED')

    await connectPage.goto()
    await connectPage.syncNow('Tartan Bank')

    await expect(connectPage.status('Tartan Bank')).toHaveText('Sign-in needed')
  })

  test('an admin imports an account the bank already shares', async ({ connectPage }) => {
    await connectPage.goto()
    await expect(connectPage.account('Tartan Bank', 'Tartan Checking')).toContainText(
      'Not imported',
    )

    await connectPage.act('Tartan Bank', 'choose')
    await connectPage.chooseAccounts('Rewards Visa', 'Tartan Checking')
    await connectPage.importAccounts()

    await expect(connectPage.account('Tartan Bank', 'Tartan Checking')).toContainText('Imported')
  })

  test('removing a bank keeps its accounts to update by hand', async ({
    connectPage,
    accountsPage,
  }) => {
    await connectPage.goto()
    await connectPage.remove('Tartan Bank')

    await expect(connectPage.card('Tartan Bank')).toHaveCount(0)
    await accountsPage.goto()
    await expect(accountsPage.row('Rewards Visa')).toBeVisible()
  })
})

test.describe('Connected banks for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeAll(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows the banks, with nothing to change', async ({ page, connectPage }) => {
    await connectPage.goto()

    await expect(page.getByTestId('read-only-notice')).toBeVisible()
    await expect(connectPage.cards).toHaveCount(2)
    await expect(connectPage.addButton).toHaveCount(0)
    await expect(connectPage.card('Tartan Bank').getByTestId('connection-sync')).toHaveCount(0)
  })
})
