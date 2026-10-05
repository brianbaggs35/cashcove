import { expect, test } from '@playwright/test'

import { ADMIN, collectProblems, HOUSEHOLD, setting } from './admin'

test('the setup wizard creates the first admin on a new install', async ({ page }) => {
  const problems = collectProblems(page)

  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome$/)
  await page.getByTestId('welcome-start').click()
  await page.getByTestId('setup-code').locator('input').fill(setting('CASHCOVE_SMOKE_SETUP_CODE'))
  await page.getByTestId('setup-code-submit').click()
  await page.getByTestId('account-name').locator('input').fill(ADMIN.name)
  await page.getByTestId('account-email').locator('input').fill(ADMIN.email)
  await page
    .getByTestId('account-password')
    .locator('input')
    .fill(setting('CASHCOVE_SMOKE_PASSWORD'))
  await page.getByTestId('account-submit').click()
  await page.getByTestId('secure-skip').click()
  await page.getByTestId('household-name').locator('input').fill(HOUSEHOLD)
  await page.getByTestId('household-submit').click()
  await page.getByTestId('welcome-finish').click()

  await expect(page).toHaveURL(/\/dashboard$/)
  expect(problems).toEqual([])
})
