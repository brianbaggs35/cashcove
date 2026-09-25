import { configureApi } from '@/api/client'
import { requestVerification } from '@/composables/verification'
import { useAuthStore } from '@/stores/auth'

/** Gives the API client the session's CSRF token and lets it ask people to confirm it's them. */
export function connectApi(): void {
  const auth = useAuthStore()
  configureApi({
    csrfToken: () => auth.session?.csrf_token ?? null,
    activity: () => {
      auth.touch()
    },
    signedOut: () => {
      if (auth.signedIn) auth.forget('expired')
    },
    verify: () => (auth.signedIn ? requestVerification() : Promise.resolve(false)),
  })
}
