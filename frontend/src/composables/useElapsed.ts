import { onScopeDispose, ref } from 'vue'

/** Whole seconds since this started, ticking every second, for saying how long a wait has been. */
export function useElapsed() {
  const seconds = ref(0)
  const started = Date.now()
  const timer = setInterval(() => {
    seconds.value = Math.floor((Date.now() - started) / 1000)
  }, 1000)
  onScopeDispose(() => {
    clearInterval(timer)
  })
  return { seconds }
}
