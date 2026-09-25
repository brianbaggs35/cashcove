import * as webauthn from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import {
  PasskeyCancelled,
  browserCanUpgradeToPasskey,
  browserHasPasskeyAutofill,
  browserHasPasskeys,
  cancelPasskeyPrompt,
  createPasskey,
  passkeyErrorMessage,
  promptForPasskey,
  relyingPartyId,
  signalCurrentPasskeys,
  signalRemovedPasskey,
  signalUserDetails,
} from '@/auth/passkeys'

vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof webauthn>()),
  browserSupportsWebAuthn: vi.fn(),
  browserSupportsWebAuthnAutofill: vi.fn(),
  getBrowserCapabilities: vi.fn(),
  sendSignal: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}))

const requestOptions = { challenge: 'abc' } as PublicKeyCredentialRequestOptionsJSON
const creationOptions = { challenge: 'abc' } as PublicKeyCredentialCreationOptionsJSON

function webAuthnError(code: webauthn.WebAuthnError['code'], cause = new Error('cause')) {
  return new webauthn.WebAuthnError({ message: 'failed', code, cause })
}

function domError(name: string) {
  return Object.assign(new Error(name), { name })
}

describe('browser support', () => {
  it('asks SimpleWebAuthn what the browser can do', async () => {
    vi.mocked(webauthn.browserSupportsWebAuthn).mockReturnValue(true)
    vi.mocked(webauthn.browserSupportsWebAuthnAutofill).mockResolvedValue(false)
    expect(browserHasPasskeys()).toBe(true)
    await expect(browserHasPasskeyAutofill()).resolves.toBe(false)
  })

  it.each([
    [{ conditionalCreate: 'supported' }, true],
    [{ conditionalCreate: 'unsupported' }, false],
  ])('knows whether a passkey can be saved quietly (%j)', async (capabilities, expected) => {
    vi.mocked(webauthn.getBrowserCapabilities).mockResolvedValue(
      capabilities as unknown as Awaited<ReturnType<typeof webauthn.getBrowserCapabilities>>,
    )
    await expect(browserCanUpgradeToPasskey()).resolves.toBe(expected)
  })

  it('assumes it cannot when the browser will not say', async () => {
    vi.mocked(webauthn.getBrowserCapabilities).mockRejectedValue(new Error('unsupported'))
    await expect(browserCanUpgradeToPasskey()).resolves.toBe(false)
  })
})

describe('passkeyErrorMessage', () => {
  it.each([
    [webAuthnError('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'), 'already has a passkey'],
    [webAuthnError('ERROR_INVALID_DOMAIN'), "at the address it's set up for"],
    [webAuthnError('ERROR_INVALID_RP_ID'), "at the address it's set up for"],
    [webAuthnError('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'), "couldn't use a passkey"],
    [new Error('other'), "couldn't use a passkey"],
  ])('explains %s', (error, words) => {
    expect(passkeyErrorMessage(error)).toContain(words)
  })
})

describe('prompts', () => {
  it('asks for a passkey, from autofill when asked to', async () => {
    const answer = { id: 'credential' } as webauthn.AuthenticationResponseJSON
    vi.mocked(webauthn.startAuthentication).mockResolvedValue(answer)
    await expect(promptForPasskey(requestOptions)).resolves.toBe(answer)
    expect(webauthn.startAuthentication).toHaveBeenLastCalledWith({
      optionsJSON: requestOptions,
      useBrowserAutofill: false,
    })
    await promptForPasskey(requestOptions, { autofill: true })
    expect(webauthn.startAuthentication).toHaveBeenLastCalledWith({
      optionsJSON: requestOptions,
      useBrowserAutofill: true,
    })
  })

  it('creates a passkey, quietly when asked to', async () => {
    const answer = { id: 'credential' } as webauthn.RegistrationResponseJSON
    vi.mocked(webauthn.startRegistration).mockResolvedValue(answer)
    await expect(createPasskey(creationOptions)).resolves.toBe(answer)
    expect(webauthn.startRegistration).toHaveBeenLastCalledWith({
      optionsJSON: creationOptions,
      useAutoRegister: false,
    })
    await createPasskey(creationOptions, { quietly: true })
    expect(webauthn.startRegistration).toHaveBeenLastCalledWith({
      optionsJSON: creationOptions,
      useAutoRegister: true,
    })
  })

  it.each([
    ['an aborted ceremony', webAuthnError('ERROR_CEREMONY_ABORTED')],
    [
      'a closed prompt',
      webAuthnError('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', domError('NotAllowedError')),
    ],
    ['a bare NotAllowedError', domError('NotAllowedError')],
    ['a bare AbortError', domError('AbortError')],
  ])('treats %s as cancelled', async (_, error) => {
    vi.mocked(webauthn.startAuthentication).mockRejectedValue(error)
    await expect(promptForPasskey(requestOptions)).rejects.toBeInstanceOf(PasskeyCancelled)
  })

  it('passes other failures on', async () => {
    const error = webAuthnError('ERROR_INVALID_DOMAIN')
    vi.mocked(webauthn.startRegistration).mockRejectedValue(error)
    await expect(createPasskey(creationOptions)).rejects.toBe(error)
    vi.mocked(webauthn.startRegistration).mockRejectedValue('not an error')
    await expect(createPasskey(creationOptions)).rejects.toBe('not an error')
  })

  it('explains a cancellation', () => {
    expect(new PasskeyCancelled()).toMatchObject({ name: 'PasskeyCancelled' })
  })

  it('closes a waiting prompt', () => {
    const cancelCeremony = vi.spyOn(webauthn.WebAuthnAbortService, 'cancelCeremony')
    cancelPasskeyPrompt()
    expect(cancelCeremony).toHaveBeenCalledOnce()
  })
})

describe('signals', () => {
  it('uses the configured domain as the relying party', () => {
    expect(relyingPartyId('https://cashcove.example.com')).toBe('cashcove.example.com')
    expect(relyingPartyId('https://localhost:8443')).toBe('localhost')
  })

  it('tells the password manager which passkeys and details are current', async () => {
    const origin = 'https://cashcove.example.com'
    await signalCurrentPasskeys(origin, 'user-handle', ['a', 'b'])
    expect(webauthn.sendSignal).toHaveBeenLastCalledWith({
      signalName: 'allAcceptedCredentials',
      rpID: 'cashcove.example.com',
      userID: 'user-handle',
      allAcceptedCredentialIDs: ['a', 'b'],
    })
    await signalRemovedPasskey(origin, 'gone')
    expect(webauthn.sendSignal).toHaveBeenLastCalledWith({
      signalName: 'unknownCredential',
      rpID: 'cashcove.example.com',
      credentialID: 'gone',
    })
    await signalUserDetails(origin, 'user-handle', 'alex@example.com', 'Alex Morgan')
    expect(webauthn.sendSignal).toHaveBeenLastCalledWith({
      signalName: 'currentUserDetails',
      rpID: 'cashcove.example.com',
      userID: 'user-handle',
      userName: 'alex@example.com',
      userDisplayName: 'Alex Morgan',
    })
  })

  it('ignores browsers that cannot take signals', async () => {
    vi.mocked(webauthn.sendSignal).mockRejectedValue(new Error('unsupported'))
    await expect(signalRemovedPasskey('https://x.example', 'gone')).resolves.toBeUndefined()
  })
})
