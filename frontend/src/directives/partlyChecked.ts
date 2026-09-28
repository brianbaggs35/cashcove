import type { Directive } from 'vue'

function mark(element: HTMLElement, { value }: { value: boolean }) {
  for (const input of element.querySelectorAll('input')) input.indeterminate = value
}

/**
 * Vuetify marks a partly ticked box as aria-checked="mixed" but leaves the checkbox itself
 * unticked, and assistive technology needs the two to agree: `v-partly-checked="some && !all"`
 * next to `:indeterminate`.
 */
export const vPartlyChecked: Directive<HTMLElement, boolean> = {
  mounted: mark,
  updated: mark,
}
