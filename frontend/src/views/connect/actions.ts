import { ApiError, errorMessage, isCancelled } from '@/api/client'
import {
  syncConnection,
  updateLinkToken,
  type Connection,
  type ConnectionSync,
  type LinkMode,
} from '@/api/connections'
import { notify } from '@/composables/notify'
import { forgetLink, linkErrorMessage, openLink, rememberLink } from '@/plaid/link'
import { useConnectionsStore } from '@/stores/connections'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** What a sync changed, e.g. "3 new transactions and 1 updated", or null when nothing. */
export function syncChanges(sync: Pick<ConnectionSync, 'added' | 'updated' | 'removed'>) {
  const changes = [
    sync.added && plural(sync.added, 'new transaction'),
    sync.updated && `${sync.updated} updated`,
    sync.removed && `${sync.removed} removed`,
  ].filter((change): change is string => !!change)
  if (!changes.length) return null
  const last = changes.pop() as string
  return changes.length ? `${changes.join(', ')} and ${last}` : last
}

/** Says how a sync went: what it brought in, or why it failed. */
function reportSync(connection: Connection, done: string) {
  if (connection.status !== 'healthy') {
    notify(connection.error_message ?? `Couldn't sync ${connection.institution_name}.`, 'error')
    return
  }
  const changes = connection.last_sync && syncChanges(connection.last_sync)
  notify(changes ? `${done}: ${changes}` : `${done}. Nothing new.`)
}

/** Fetches what's new from the bank now, rather than waiting for the schedule. */
export async function syncNow(connection: Connection): Promise<void> {
  const store = useConnectionsStore()
  try {
    const synced = await syncConnection(connection.id)
    store.put(synced)
    reportSync(synced, `Synced ${connection.institution_name}`)
  } catch (error) {
    if (isCancelled(error)) return
    const busy = error instanceof ApiError && error.code === 'already_syncing'
    notify(errorMessage(error), busy ? 'info' : 'error')
    if (busy) void store.load()
  }
}

/**
 * Opens Plaid Link for a connected bank, to sign in to it again or to change which accounts it
 * shares, then syncs. Resolves to the updated connection, or null when that didn't happen.
 * `resume` picks up after a bank's own sign-in page sent people back to Cashcove.
 */
export async function relink(
  connection: Connection,
  mode: LinkMode,
  resume?: { token: string; redirectUri: string },
): Promise<Connection | null> {
  const store = useConnectionsStore()
  try {
    const token = resume?.token ?? (await updateLinkToken(connection.id, mode)).link_token
    rememberLink({ token, purpose: mode, connectionId: connection.id, historyDays: null })
    const outcome = await openLink(token, resume?.redirectUri)
    forgetLink()
    if (!outcome.connected) {
      if (outcome.error) notify(linkErrorMessage(outcome.error), 'error')
      return null
    }
    const synced = await syncConnection(connection.id, 'reconnected')
    store.put(synced)
    if (mode === 'reconnect') reportSync(synced, `Reconnected ${connection.institution_name}`)
    return synced
  } catch (error) {
    forgetLink()
    if (!isCancelled(error)) notify(errorMessage(error), 'error')
    return null
  }
}
