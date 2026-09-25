import { DOMWrapper } from '@vue/test-utils'

/**
 * The whole page, for finding what Vuetify moves out of the component into <body>: dialogs,
 * menus and snackbars.
 */
export function page() {
  return new DOMWrapper(document.body)
}

/** Clicks something on the page, e.g. an item in an open menu or a dialog button. */
export async function click(selector: string) {
  const target = page().find(selector)
  if (!target.exists()) throw new Error(`Nothing on the page matches ${selector}`)
  await target.trigger('click')
}

/** Gives the page a clipboard, which jsdom lacks. */
export function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}
