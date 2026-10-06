import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { fetchAiReview, type AiReview } from '@/api/ai'
import { errorMessage } from '@/api/client'
import { reviewActive } from '@/utils/ai'

/** How often a review that's still going is looked at again. */
export const POLL_INTERVAL = 1500
/** What's used, in a place a test can shorten it, so it needn't wait. */
export const polling = { interval: POLL_INTERVAL }

/**
 * Follows a review while it carries on after the request that started it: reads it again every
 * moment until it's finished or stopped, then calls `onFinished` once.
 */
export function useReviewProgress(
  id: MaybeRefOrGetter<string | null>,
  onFinished?: (review: AiReview) => void,
) {
  const review = ref<AiReview | null>(null)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Only the latest review gets to show, whatever order the answers come back in. */
  let latest = 0

  const active = computed(() => !!review.value && reviewActive(review.value.status))

  function stop() {
    clearTimeout(timer)
    timer = undefined
  }

  async function refresh(): Promise<void> {
    const wanted = toValue(id)
    const turn = ++latest
    stop()
    if (wanted === null) {
      review.value = null
      return
    }
    try {
      const found = await fetchAiReview(wanted)
      if (turn !== latest) return
      review.value = found
      error.value = null
      if (reviewActive(found.status)) timer = setTimeout(() => void refresh(), polling.interval)
      else onFinished?.(found)
    } catch (readError) {
      if (turn === latest) error.value = errorMessage(readError)
    }
  }

  watch(
    () => toValue(id),
    () => void refresh(),
    { immediate: true },
  )
  onScopeDispose(() => {
    latest += 1
    stop()
  })

  return { review, error, active, refresh }
}
