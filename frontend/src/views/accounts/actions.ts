import { Archive, Trash2 } from '@lucide/vue'

import { deleteAccount, updateAccount, type Account } from '@/api/accounts'
import { errorMessage, isCancelled } from '@/api/client'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Closes an account after checking; it keeps its transactions and can be reopened. */
export async function closeAccount(account: Account) {
  const done = await confirmAndRun(
    {
      title: `Close ${account.name}?`,
      text: "It moves to your closed accounts and stops counting toward your net worth. Its transactions stay, and you can reopen it at any time.",
      confirmText: 'Close account',
      tone: 'warning',
      icon: Archive,
    },
    () => updateAccount(account.id, { closed: true }),
  )
  if (!done) return
  useAccountsStore().put(done.result)
  notify(`Closed ${account.name}`)
}

export async function reopenAccount(account: Account) {
  try {
    useAccountsStore().put(await updateAccount(account.id, { closed: false }))
    notify(`Reopened ${account.name}`)
  } catch (error) {
    if (!isCancelled(error)) notify(errorMessage(error), 'error')
  }
}

/** Deletes an account and its transactions for good, after checking. */
export async function removeAccount(account: Account) {
  const history = account.transaction_count
    ? `This deletes it and its ${plural(account.transaction_count, 'transaction')} for good.`
    : 'This deletes it for good.'
  const done = await confirmAndRun(
    {
      title: `Delete ${account.name}?`,
      text: `${history} To keep its history, close it instead.`,
      confirmText: 'Delete account',
      tone: 'error',
      icon: Trash2,
    },
    () => deleteAccount(account.id),
  )
  if (!done) return
  useAccountsStore().remove(account.id)
  notify(`Deleted ${account.name}`)
}
