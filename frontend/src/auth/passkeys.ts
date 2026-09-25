import {
  WebAuthnAbortService,
  WebAuthnError,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  getBrowserCapabilities,
  sendSignal,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser'

/** Thrown when the person closed the passkey prompt or it was replaced by another one. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('The passkey prompt was closed.')
    this.name = 'PasskeyCancelled'
  }
}

/** Whether this browser can use passkeys at all. */
export function browserHasPasskeys(): boolean {
  return browserSupportsWebAuthn()
}

/** Whether the browser can offer passkeys in the email field's autofill menu. */
export function browserHasPasskeyAutofill(): Promise<boolean> {
  return browserSupportsWebAuthnAutofill()
}

/** Whether the password manager can quietly save a passkey right after a password sign-in. */
export async function browserCanUpgradeToPasskey(): Promise<boolean> {
  try {
    return (await getBrowserCapabilities()).conditionalCreate === 'supported'
  } catch {
    return false
  }
}

function errorName(error: unknown): string {
  if (error instanceof WebAuthnError && error.cause instanceof Error) return error.cause.name
  return error instanceof Error ? error.name : ''
}

function wasCancelled(error: unknown): boolean {
  // NotAllowedError covers both "the person closed the prompt" and "it timed out".
  if (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED') return true
  return ['NotAllowedError', 'AbortError'].includes(errorName(error))
}

/** Words for a passkey error the person should see; cancellations never get this far. */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof WebAuthnError) {
    if (error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return 'This device already has a passkey for Cashcove.'
    }
    if (error.code === 'ERROR_INVALID_DOMAIN' || error.code === 'ERROR_INVALID_RP_ID') {
      return "Passkeys only work when Cashcove is opened at the address it's set up for."
    }
  }
  return "Your device couldn't use a passkey just now. Try again, or use another way."
}

async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (wasCancelled(error)) throw new PasskeyCancelled()
    throw error
  }
}

/** Asks the browser to sign a challenge with one of this site's passkeys. */
export function promptForPasskey(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
  { autofill = false }: { autofill?: boolean } = {},
): Promise<AuthenticationResponseJSON> {
  return ceremony(() => startAuthentication({ optionsJSON, useBrowserAutofill: autofill }))
}

/** Asks the browser to create a passkey; `quietly` lets the password manager do it unprompted. */
export function createPasskey(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
  { quietly = false }: { quietly?: boolean } = {},
): Promise<RegistrationResponseJSON> {
  return ceremony(() => startRegistration({ optionsJSON, useAutoRegister: quietly }))
}

/** Closes any passkey prompt or autofill request that's still waiting. */
export function cancelPasskeyPrompt(): void {
  WebAuthnAbortService.cancelCeremony()
}

/** The domain passkeys are bound to, taken from the address Cashcove is configured for. */
export function relyingPartyId(origin: string): string {
  return new URL(origin).hostname
}

// Signals keep the browser's password manager in step with Cashcove, so it stops offering
// passkeys that were removed here and shows people's current names. They're best effort:
// browsers without the Signal API simply ignore them.

async function signal(options: Parameters<typeof sendSignal>[0]): Promise<void> {
  try {
    await sendSignal(options)
  } catch {
    // Not supported, or the browser declined; nothing depends on it.
  }
}

export function signalCurrentPasskeys(
  origin: string,
  userId: string,
  credentialIds: string[],
): Promise<void> {
  return signal({
    signalName: 'allAcceptedCredentials',
    rpID: relyingPartyId(origin),
    userID: userId,
    allAcceptedCredentialIDs: credentialIds,
  })
}

export function signalRemovedPasskey(origin: string, credentialId: string): Promise<void> {
  return signal({
    signalName: 'unknownCredential',
    rpID: relyingPartyId(origin),
    credentialID: credentialId,
  })
}

export function signalUserDetails(
  origin: string,
  userId: string,
  email: string,
  name: string,
): Promise<void> {
  return signal({
    signalName: 'currentUserDetails',
    rpID: relyingPartyId(origin),
    userID: userId,
    userName: email,
    userDisplayName: name,
  })
}
