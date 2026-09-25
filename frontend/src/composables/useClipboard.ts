import { onScopeDispose, ref } from 'vue'

import { notify } from '@/composables/notify'

/** Copies text, with a `copied` flag that stays on long enough to show a check mark. */
export function useClipboard(resetAfter = 2000) {
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      notify("Couldn't copy that. Select the text and copy it yourself.", 'error')
      return false
    }
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), resetAfter)
    return true
  }

  onScopeDispose(() => {
    clearTimeout(timer)
  })
  return { copied, copy }
}
