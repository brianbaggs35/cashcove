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

/**
 * Types into a date field the way a browser does, which Vuetify's date input needs: it reads
 * what changed between `beforeinput` and `input`. An empty text clears the field.
 */
export async function typeDate(input: DOMWrapper<Element>, text: string) {
  const element = input.element as HTMLInputElement
  element.focus()
  element.setSelectionRange(0, element.value.length)
  const inputType = text ? 'insertText' : 'deleteContentBackward'
  element.dispatchEvent(new InputEvent('beforeinput', { inputType, data: text, bubbles: true }))
  element.value = text
  element.dispatchEvent(new InputEvent('input', { inputType, data: text, bubbles: true }))
  await input.trigger('keydown', { key: 'Enter' })
}
