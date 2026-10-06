import { ref } from 'vue'

import { applyRecommendations, dismissRecommendations } from '@/api/ai'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { formatCount } from '@/utils/format'

/** What to add when some suggestions were left alone because their transactions had changed. */
function leftAlone(skipped: number): string {
  if (!skipped) return ''
  const verb = skipped === 1 ? 'was' : 'were'
  return ` ${formatCount(skipped, 'transaction')} had changed since, and ${verb} left alone.`
}

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
      notify(`Applied ${formatCount(result.changed, 'suggestion')}.${leftAlone(result.skipped)}`)
    } else {
      notify(`Dismissed ${formatCount(result.changed, 'suggestion')}.`)
    }
    selected.value = []
    await afterwards()
  })

  return { selected, decide }
}
