import { flushPromises } from '@vue/test-utils'

import { confirmRequest } from '@/composables/confirm'

/** Answers the confirmation being asked, running its action as the dialog would. */
export async function answer(confirmed: boolean) {
  const request = confirmRequest.value
  if (!request) throw new Error('Nothing is asking for confirmation')
  if (confirmed) await request.action?.()
  request.resolve(confirmed)
  await flushPromises()
}

/** Waits past Vuetify ignoring a click that would reopen a menu within 50ms of it closing. */
export const menuSettled = () => new Promise((resolve) => setTimeout(resolve, 60))
