import { expect, signInFiles, test } from '../support'

/** The main color of the first theme and of two others, as `--v-theme-primary` holds them. */
const PRIMARY = {
  cashcove: { light: '15,113,106', dark: '45,212,191' },
  ocean: { light: '11,92,173', dark: '96,165,250' },
  berry: { light: '162,28,175', dark: '232,121,249' },
}

const IDS = ['cashcove', 'ocean', 'forest', 'berry', 'sunset', 'graphite', 'contrast']

test.describe('Color themes', () => {
  test.use({ storageState: signInFiles.admin, colorScheme: 'light' })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('start with the original colors, and offer six more beside them', async ({
    appearancePage,
  }) => {
    await appearancePage.goto()

    await expect(appearancePage.palettes.getByRole('button')).toHaveCount(IDS.length)
    for (const id of IDS) {
      await expect(appearancePage.palette(id)).toHaveAttribute(
        'aria-pressed',
        id === 'cashcove' ? 'true' : 'false',
      )
    }
    await expect(appearancePage.palette('contrast')).toContainText('High contrast')
    expect(await appearancePage.primary()).toBe(PRIMARY.cashcove.light)
  })

  test('recolor the app at once, in light, dark and Match device, and are remembered', async ({
    page,
    appearancePage,
  }) => {
    await appearancePage.goto()

    await appearancePage.choosePalette('ocean')
    expect(await appearancePage.primary()).toBe(PRIMARY.ocean.light)
    // Light or dark is its own choice, and the palette comes in both.
    await appearancePage.chooseMode('dark')
    expect(await appearancePage.primary()).toBe(PRIMARY.ocean.dark)
    await appearancePage.chooseMode('light')
    expect(await appearancePage.primary()).toBe(PRIMARY.ocean.light)
    await appearancePage.chooseMode('system')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => appearancePage.primary()).toBe(PRIMARY.ocean.dark)

    // The choice is kept on this device, and is there from the first moment of a page.
    await page.reload()
    await expect(appearancePage.palette('ocean')).toHaveAttribute('aria-pressed', 'true')
    expect(await appearancePage.primary()).toBe(PRIMARY.ocean.dark)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await appearancePage.primary()).toBe(PRIMARY.ocean.dark)
    expect(await page.evaluate(() => localStorage.getItem('cashcove.palette'))).toBe('ocean')

    await appearancePage.goto()
    await appearancePage.choosePalette('cashcove')
    expect(await appearancePage.primary()).toBe(PRIMARY.cashcove.dark)
  })

  test('are shown in the theme the app is wearing', async ({ appearancePage }) => {
    await appearancePage.goto()
    const accent = (id: string) => appearancePage.palette(id).locator('.theme-preview__layer')

    await expect(accent('forest')).toHaveAttribute('style', /--accent: #166534/)
    await expect(accent('forest')).toHaveAttribute('style', /--bg: #f2f7f2/)

    await appearancePage.chooseMode('dark')

    await expect(accent('forest')).toHaveAttribute('style', /--accent: #4ade80/)
    await expect(accent('forest')).toHaveAttribute('style', /--bg: #09130d/)
    // Light, Dark and Match device show the one being worn.
    await appearancePage.choosePalette('berry')
    await expect(appearancePage.mode('light').locator('.theme-preview__layer')).toHaveAttribute(
      'style',
      /--accent: #a21caf/,
    )
    await expect(appearancePage.mode('dark').locator('.theme-preview__layer')).toHaveAttribute(
      'style',
      /--accent: #e879f9/,
    )
    await expect(appearancePage.mode('system').locator('.theme-preview__layer')).toHaveCount(2)
  })

  test('fit the screen, with every one in reach', async ({ page, appearancePage }) => {
    await appearancePage.goto()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    for (const id of IDS) await expect(appearancePage.palette(id)).toBeVisible()
  })
})

test.describe('Color themes for a viewer', () => {
  test.use({ storageState: signInFiles.viewer, colorScheme: 'light' })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('are the viewer’s to choose, since they are only kept on their device', async ({
    page,
    appearancePage,
  }) => {
    await appearancePage.goto()

    await appearancePage.choosePalette('berry')
    expect(await appearancePage.primary()).toBe(PRIMARY.berry.light)

    await page.reload()
    await expect(appearancePage.palette('berry')).toHaveAttribute('aria-pressed', 'true')
    expect(await appearancePage.primary()).toBe(PRIMARY.berry.light)
  })
})
