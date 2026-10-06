import { ref } from 'vue'

import { applyRecommendations, dismissRecommendations } from '@/api/ai'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { formatCount } from '@/utils/format'

/**
 * Applying or turning down the AI's suggestions, one or several at once: what's ticked, what
 * to say about the result, and a refresh of whatever shows them. A suggestion whose transaction
 * has changed since is left alone, and the message says so.
 */
export function useRecommendationActions(afterwards: () => Promise<unknown>) {
  const selected = ref<string[]>([])

  const decide = useAction(async (kind: 'apply' | 'dismiss', ids: string[]) => {
    const result =
      kind === 'apply' ? await applyRecommendations(ids) : await dismissRecommendations(ids)
    if (kind === 'apply') {
      const left = result.skipped
        ? ` ${formatCount(result.skipped, 'transaction')} had changed since, and ${result.skipped === 1 ? 'was' : 'were'} left alone.`
        : ''
      notify(`Applied ${formatCount(result.changed, 'suggestion')}.${left}`)
    } else {
      notify(`Dismissed ${formatCount(result.changed, 'suggestion')}.`)
    }
    selected.value = []
    await afterwards()
  })

  return { selected, decide }
}
