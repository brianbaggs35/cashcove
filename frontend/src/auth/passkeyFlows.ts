import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { addPasskey, passkeyRegistrationOptions, type Passkey } from '@/api/account'
import type { PasskeyOptions } from '@/api/auth'
import {
  PasskeyCancelled,
  createPasskey,
  passkeyErrorMessage,
  promptForPasskey,
} from '@/auth/passkeys'
import { useAuthStore } from '@/stores/auth'

/** A passkey prompt failed for a reason worth telling the person about. */
export class PasskeyError extends Error {
  constructor(cause: unknown) {
    super(passkeyErrorMessage(cause))
    this.name = 'PasskeyError'
  }
}

async function prompt<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof PasskeyCancelled) return null
    throw new PasskeyError(error)
  }
}

/**
 * Gets a challenge, has the browser sign it with a passkey, and sends the answer back.
 * Resolves to null when the person closed the prompt.
 */
export async function answerWithPasskey<T>(
  getOptions: () => Promise<PasskeyOptions<PublicKeyCredentialRequestOptionsJSON>>,
  submit: (challengeId: string, credential: AuthenticationResponseJSON) => Promise<T>,
  { autofill = false }: { autofill?: boolean } = {},
): Promise<T | null> {
  const { challenge_id: challengeId, options } = await getOptions()
  const credential = await prompt(() => promptForPasskey(options, { autofill }))
  return credential === null ? null : submit(challengeId, credential)
}

/**
 * Creates a passkey for the signed-in person and saves it to their account. `quietly` lets the
 * password manager do it without a prompt, right after a password sign-in. Resolves to null
 * when the person (or their password manager) declined.
 */
export async function addPasskeyToAccount(
  name = '',
  { quietly = false }: { quietly?: boolean } = {},
): Promise<Passkey | null> {
  const { challenge_id: challengeId, options } = await passkeyRegistrationOptions()
  const credential = await prompt(() => createPasskey(options, { quietly }))
  if (credential === null) return null
  const passkey = await addPasskey(challengeId, credential, name)
  const auth = useAuthStore()
  auth.updateUser({ passkey_count: (auth.user?.passkey_count ?? 0) + 1 })
  return passkey
}
