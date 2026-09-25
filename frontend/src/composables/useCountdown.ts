import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

/** Whole seconds left until `deadline` (a timestamp in milliseconds), ticking every second. */
export function useCountdown(deadline: Ref<number | null>) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined

  function stop() {
    clearInterval(timer)
    timer = undefined
  }

  watch(
    deadline,
    (value) => {
      stop()
      now.value = Date.now()
      if (value !== null && value > now.value) {
        timer = setInterval(() => {
          now.value = Date.now()
          if (now.value >= value) stop()
        }, 1000)
      }
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  const remaining = computed(() =>
    deadline.value === null ? 0 : Math.max(0, Math.ceil((deadline.value - now.value) / 1000)),
  )
  return { remaining, running: computed(() => remaining.value > 0) }
}
