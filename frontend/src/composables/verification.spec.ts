import { requestVerification, verificationRequest } from '@/composables/verification'

describe('requestVerification', () => {
  it('opens one prompt for requests made while it is open', async () => {
    const first = requestVerification()
    const second = requestVerification()
    expect(second).toBe(first)
    verificationRequest.value!.resolve(true)
    await expect(first).resolves.toBe(true)
    expect(verificationRequest.value).toBeNull()

    const next = requestVerification()
    expect(next).not.toBe(first)
    verificationRequest.value!.resolve(false)
    await expect(next).resolves.toBe(false)
  })
})
