import { ref } from 'vue'

import { ApiError, errorMessage, isCancelled } from '@/api/client'

/**
 * Wraps an async action with a busy flag for its button and a message for whatever went wrong.
 * `run` resolves to the action's result, or undefined when it failed or was cancelled.
 */
export function useAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
) {
  const busy = ref(false)
  const error = ref<string | null>(null)
  /** The API's code for the last failure, e.g. `email_taken`, to put a message by its field. */
  const code = ref<string | null>(null)
  /** Messages for individual fields when the API rejected what was entered. */
  const fields = ref<Readonly<Record<string, string>>>({})

  function clear() {
    error.value = null
    code.value = null
    fields.value = {}
  }

  async function run(...args: Args): Promise<Result | undefined> {
    busy.value = true
    clear()
    try {
      return await action(...args)
    } catch (caught) {
      if (!isCancelled(caught)) {
        error.value = errorMessage(caught)
        code.value = caught instanceof ApiError ? caught.code : null
        fields.value = caught instanceof ApiError ? caught.fields : {}
      }
      return undefined
    } finally {
      busy.value = false
    }
  }

  return { busy, error, code, fields, run, clear }
}
