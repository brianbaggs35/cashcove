import { shallowRef } from 'vue'

export interface VerificationRequest {
  resolve: (verified: boolean) => void
}

/** The "Confirm it's you" prompt that's open right now, shown by VerifyIdentityHost. */
export const verificationRequest = shallowRef<VerificationRequest | null>(null)

let pending: Promise<boolean> | null = null

/**
 * Asks the person to confirm it's them before a sensitive change. Requests made while the
 * prompt is open share it, so two changes at once don't ask twice.
 */
export function requestVerification(): Promise<boolean> {
  pending ??= new Promise<boolean>((resolve) => {
    verificationRequest.value = {
      resolve: (verified) => {
        verificationRequest.value = null
        pending = null
        resolve(verified)
      },
    }
  })
  return pending
}
