import { expect, expectAccessible, signInFiles, test } from '../support'

/** Every color theme but the original, which the accessibility spec already covers. */
const PALETTES = ['ocean', 'forest', 'berry', 'sunset', 'graphite', 'contrast']

/** A page of text and controls, one of charts, one of a table, and the page that chooses. */
const PAGES = ['/dashboard', '/transactions', '/settings/appearance']

test.describe('Color themes are accessible', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      test.use({ colorScheme })

      for (const palette of PALETTES) {
        test(`${palette}, on the pages with the most to read`, async ({ page, context }) => {
          // Three pages are checked with axe, and a slow runner takes a while over each.
          test.slow()
          await context.addInitScript((id) => {
            localStorage.setItem('cashcove.palette', id)
          }, palette)

          for (const path of PAGES) {
            await test.step(path, async () => {
              await page.goto(path)
              await expect(page.getByTestId('app-loading')).toHaveCount(0, { timeout: 15_000 })
              await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
              await expect(page.getByTestId('transactions-loading')).toHaveCount(0)

              await expectAccessible(page)
            })
          }
        })
      }
    })
  }
})
