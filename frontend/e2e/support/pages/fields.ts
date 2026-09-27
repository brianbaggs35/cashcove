import type { Locator } from '@playwright/test'

/** Matches exactly this text, give or take surrounding whitespace. */
export function exactly(text: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`)
}

/** Matches text that starts with this. */
export function startingWith(text: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(text)}`)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The text box of a select, autocomplete or combobox field. */
export function comboboxInput(field: Locator): Locator {
  // Vuetify gives the field's frame the combobox role too, without a name.
  return field.locator('input[role="combobox"]')
}

/**
 * Picks an option in a select or autocomplete field, by its title. An autocomplete gets the
 * text typed in first (`search`, or the option itself), so long lists don't need scrolling.
 */
export async function choose(
  field: Locator,
  option: string | RegExp,
  { search }: { search?: string } = {},
): Promise<void> {
  const page = field.page()
  const input = comboboxInput(field)
  // A select shows its choice over its text box, so open it from the field's frame.
  await field.locator('.v-field').click()
  const text = search ?? (typeof option === 'string' ? option : undefined)
  if (text !== undefined && (await input.isEditable())) await input.fill(text)
  const title = page.locator('.v-list-item-title', {
    hasText: typeof option === 'string' ? exactly(option) : option,
  })
  await page.getByRole('option').filter({ has: title }).click()
}

/** Types a date (YYYY-MM-DD) into a date field, in the baseline household's US format. */
export async function typeDate(field: Locator, date: string): Promise<void> {
  const [year, month, day] = date.split('-')
  const input = field.getByRole('textbox')
  await input.fill(`${month}/${day}/${year}`)
  await input.press('Enter')
}
