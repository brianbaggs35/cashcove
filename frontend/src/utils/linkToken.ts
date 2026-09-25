/**
 * Reads the one-time token from a link like /invite#token and removes it from the address bar,
 * so it doesn't linger in history, bookmarks or screenshots. The token was never sent to the
 * server: browsers keep everything after "#" to themselves.
 */
export function takeLinkToken(): string {
  const hash = window.location.hash.slice(1)
  if (!hash) return ''
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  )
  try {
    return decodeURIComponent(hash)
  } catch {
    return ''
  }
}
