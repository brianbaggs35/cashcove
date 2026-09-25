import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'
import { createPinia, setActivePinia } from 'pinia'

import * as account from '@/api/account'
import type { PasskeyCreationOptions, PasskeyRequestOptions } from '@/api/auth'
import { PasskeyError, addPasskeyToAccount, answerWithPasskey } from '@/auth/passkeyFlows'
import * as passkeys from '@/auth/passkeys'
import { useAuthStore } from '@/stores/auth'
import { makePasskey, makeSessionState, makeUser } from '@/test/fixtures'

const requestOptions = {
  challenge_id: 'challenge',
  options: { challenge: 'abc' },
} as PasskeyRequestOptions
const creationOptions = {
  challenge_id: 'challenge',
  options: { challenge: 'abc' },
} as PasskeyCreationOptions
const assertion = { id: 'credential' } as AuthenticationResponseJSON
const attestation = { id: 'credential' } as RegistrationResponseJSON

describe('answerWithPasskey', () => {
  it('signs the challenge and sends the answer back', async () => {
    const prompt = vi.spyOn(passkeys, 'promptForPasskey').mockResolvedValue(assertion)
    const submit = vi.fn().mockResolvedValue('signed in')
    await expect(answerWithPasskey(() => Promise.resolve(requestOptions), submit)).resolves.toBe(
      'signed in',
    )
    expect(prompt).toHaveBeenCalledWith(requestOptions.options, { autofill: false })
    expect(submit).toHaveBeenCalledWith('challenge', assertion)
    await answerWithPasskey(() => Promise.resolve(requestOptions), submit, { autofill: true })
    expect(prompt).toHaveBeenLastCalledWith(requestOptions.options, { autofill: true })
  })

  it('resolves to null when the person closes the prompt', async () => {
    vi.spyOn(passkeys, 'promptForPasskey').mockRejectedValue(new passkeys.PasskeyCancelled())
    const submit = vi.fn()
    await expect(
      answerWithPasskey(() => Promise.resolve(requestOptions), submit),
    ).resolves.toBeNull()
    expect(submit).not.toHaveBeenCalled()
  })

  it('explains other failures', async () => {
    vi.spyOn(passkeys, 'promptForPasskey').mockRejectedValue(new Error('broken'))
    const failure = answerWithPasskey(() => Promise.resolve(requestOptions), vi.fn())
    await expect(failure).rejects.toBeInstanceOf(PasskeyError)
    await expect(failure).rejects.toMatchObject({
      name: 'PasskeyError',
      message: expect.stringContaining("couldn't use a passkey"),
    })
  })
})

describe('addPasskeyToAccount', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(account, 'passkeyRegistrationOptions').mockResolvedValue(creationOptions)
  })

  it('creates a passkey, saves it and counts it', async () => {
    useAuthStore().apply(makeSessionState({ user: makeUser({ passkey_count: 1 }) }))
    const create = vi.spyOn(passkeys, 'createPasskey').mockResolvedValue(attestation)
    const saved = makePasskey()
    const add = vi.spyOn(account, 'addPasskey').mockResolvedValue(saved)
    await expect(addPasskeyToAccount('Laptop')).resolves.toBe(saved)
    expect(create).toHaveBeenCalledWith(creationOptions.options, { quietly: false })
    expect(add).toHaveBeenCalledWith('challenge', attestation, 'Laptop')
    expect(useAuthStore().user?.passkey_count).toBe(2)
  })

  it('can be done quietly, without a name', async () => {
    const create = vi.spyOn(passkeys, 'createPasskey').mockResolvedValue(attestation)
    const add = vi.spyOn(account, 'addPasskey').mockResolvedValue(makePasskey())
    await addPasskeyToAccount(undefined, { quietly: true })
    expect(create).toHaveBeenCalledWith(creationOptions.options, { quietly: true })
    expect(add).toHaveBeenCalledWith('challenge', attestation, '')
  })

  it('resolves to null when declined', async () => {
    vi.spyOn(passkeys, 'createPasskey').mockRejectedValue(new passkeys.PasskeyCancelled())
    const add = vi.spyOn(account, 'addPasskey')
    await expect(addPasskeyToAccount()).resolves.toBeNull()
    expect(add).not.toHaveBeenCalled()
  })
})
