import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchSession, signOut as endSession, type SessionState, type User } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { browserHasPasskeys } from '@/auth/passkeys'

/** Why someone is looking at the sign-in page, so it can say what happened. */
export type SignedOutReason = 'signed_out' | 'expired' | 'password_reset'

export const useAuthStore = defineStore('auth', () => {
  const state = ref<SessionState | null>(null)
  const loadError = ref<string | null>(null)
  const signedOutReason = ref<SignedOutReason | null>(null)
  /** When a request last reached the API, which restarts the server's idle timer. */
  const lastActivity = ref(Date.now())
  let loading: Promise<void> | null = null

  const user = computed(() => state.value?.user ?? null)
  const session = computed(() => state.value?.session ?? null)
  const signedIn = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const setupRequired = computed(() => state.value?.setup_required === true)
  const origin = computed(() => state.value?.origin ?? window.location.origin)
  /** Cashcove opened somewhere other than its configured address, e.g. by IP. */
  const wrongOrigin = computed(
    () => state.value !== null && origin.value !== window.location.origin,
  )
  /** Passkeys need a browser that has them and Cashcove opened by its domain name. */
  const passkeysAvailable = computed(
    () => state.value?.passkeys_supported === true && !wrongOrigin.value && browserHasPasskeys(),
  )

  function apply(next: SessionState) {
    state.value = next
    lastActivity.value = Date.now()
    if (next.user) signedOutReason.value = null
  }

  async function load(): Promise<void> {
    loadError.value = null
    try {
      apply(await fetchSession())
    } catch (error) {
      loadError.value = errorMessage(error)
      throw error
    }
  }

  /** Loads the session once; the router waits for it before showing the first page. */
  function ensureLoaded(): Promise<void> {
    loading ??= load().catch((error: unknown) => {
      loading = null
      throw error
    })
    return loading
  }

  /** Updates details of the signed-in person, e.g. after they add a passkey. */
  function updateUser(changes: Partial<User>) {
    const current = state.value
    if (current?.user) state.value = { ...current, user: { ...current.user, ...changes } }
  }

  /** Clears the signed-in person, e.g. when the API says the session has ended. */
  function forget(reason: SignedOutReason) {
    if (state.value) state.value = { ...state.value, user: null, session: null }
    signedOutReason.value = reason
  }

  async function signOut() {
    try {
      await endSession()
    } catch {
      // Already signed out on the server, or unreachable: this browser forgets either way.
    }
    forget('signed_out')
  }

  function touch() {
    lastActivity.value = Date.now()
  }

  return {
    state,
    loadError,
    signedOutReason,
    lastActivity,
    user,
    session,
    signedIn,
    isAdmin,
    setupRequired,
    origin,
    wrongOrigin,
    passkeysAvailable,
    apply,
    load,
    ensureLoaded,
    updateUser,
    forget,
    signOut,
    touch,
  }
})
