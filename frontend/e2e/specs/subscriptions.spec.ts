import {
  choose,
  expect,
  openOverlays,
  signInFiles,
  test,
  type BaselineTransaction,
  type ApiClient,
} from '../support'

interface Subscription {
  id: string
  name: string
  active: boolean
  payment_count: number
}

interface TransactionPage {
  items: { id: string; subscription_id: string | null }[]
}

function dateInHouseholdDays(days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts()
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value)
  const date = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days))
  return date.toISOString().slice(0, 10)
}

async function linkedPayments(api: ApiClient, subscriptionId: string): Promise<TransactionPage> {
  return api.get<TransactionPage>(`/transactions?subscription_id=${subscriptionId}`)
}

test.describe('Subscriptions', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('creates from a past payment, edits, pauses, uses alert settings, and deletes', async ({
    page,
    baseline,
    apiAs,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const netflix: BaselineTransaction = baseline.transactions.netflix
    await page.goto('/subscriptions')
    const firstAdd = page.getByTestId('subscription-add-first')
    await firstAdd.click()

    const dialog = page.getByRole('dialog')
    await dialog.getByTestId('subscription-name').getByRole('textbox').fill('Netflix Plus')
    await choose(dialog.getByTestId('subscription-account'), 'Rewards Visa')
    await choose(dialog.getByTestId('subscription-seed-transaction'), /Netflix/, {
      search: 'Netflix',
    })
    const dueDate = dateInHouseholdDays(4)
    const [year, month, day] = dueDate.split('-')
    await dialog
      .getByTestId('subscription-due-date')
      .getByRole('textbox')
      .fill(`${month}/${day}/${year}`)
    await dialog.getByTestId('subscription-due-date').getByRole('textbox').press('Tab')
    await dialog.getByTestId('subscription-save').click()
    await expect(dialog).toBeHidden()

    const card = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Plus' })
    await expect(card.getByTestId('subscription-title')).toHaveText('Netflix Plus')
    await expect(card.getByTestId('subscription-payment-count')).toContainText('1 payment tracked')
    await expect(page.getByTestId('subscriptions-due-alert')).toHaveCount(0)

    const created = await api.get<Subscription[]>('/subscriptions')
    expect(created).toHaveLength(1)
    const subscription = created[0]!
    expect(subscription.name).toBe('Netflix Plus')
    expect(subscription.payment_count).toBe(1)
    const payments = await linkedPayments(api, subscription.id)
    expect(payments.items.map((transaction) => transaction.id)).toContain(netflix.id)
    expect(
      payments.items.every((transaction) => transaction.subscription_id === subscription.id),
    ).toBe(true)

    await card.getByTestId('subscription-view-payments').click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*subscription=${subscription.id}`))
    await expect(transactionsPage.row('Netflix')).toBeVisible()

    await page.goto('/subscriptions')
    const currentCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Plus' })
    await currentCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-edit').click()
    const editDialog = page.getByRole('dialog')
    await editDialog.getByTestId('subscription-name').getByRole('textbox').fill('Netflix Family')
    await editDialog.getByTestId('subscription-save').click()
    await expect(editDialog).toBeHidden()
    await expect(page.getByTestId('subscription-title')).toHaveText('Netflix Family')

    const editedCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Family' })
    await editedCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-toggle').click()
    await page.getByTestId('subscription-filter').getByRole('button', { name: 'Paused' }).click()
    const pausedCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Family' })
    await expect(pausedCard.getByTestId('subscription-paused-chip')).toBeVisible()
    expect((await api.get<Subscription[]>('/subscriptions?active=false'))[0]?.active).toBe(false)

    await pausedCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-toggle').click()
    await page.getByTestId('subscription-filter').getByRole('button', { name: 'Active' }).click()
    await expect(page.getByTestId('subscriptions-due-alert')).toHaveCount(0)

    await page.goto('/settings/alerts')
    await expect(page).toHaveURL(/\/settings\/alerts$/)
    const alertRow = page.getByTestId('alert-subscription')
    await alertRow.getByRole('textbox', { name: "Days before it's due" }).fill('5')
    await page.getByTestId('save-bar').getByTestId('save').click()
    await expect(page.getByTestId('save-bar')).toHaveCount(0)
    await page.goto('/subscriptions')
    await expect(page.getByTestId('subscriptions-due-alert')).toContainText(
      '1 payment is due within your 5-day reminder window.',
    )
    await expect(page.getByTestId('subscription-due-alert')).toContainText(
      'Payment due within your 5-day reminder window.',
    )

    await page
      .getByTestId('subscriptions-due-alert')
      .getByRole('link', { name: 'Alert settings' })
      .click()
    await expect(page).toHaveURL(/\/settings\/alerts$/)
    await expect(
      page.getByTestId('alert-subscription').getByRole('textbox', { name: "Days before it's due" }),
    ).toHaveValue('5')
    await page.goBack()

    const finalCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Family' })
    await finalCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-delete').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    expect(await api.get<Subscription[]>('/subscriptions')).toHaveLength(0)
    const retainedPayments = await api.get<TransactionPage>(
      `/transactions?account_id=${netflix.account_id}`,
    )
    expect(
      retainedPayments.items.find((transaction) => transaction.id === netflix.id)?.subscription_id,
    ).toBeNull()
  })
})
