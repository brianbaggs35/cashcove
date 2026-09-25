import { ApiError } from '@/api/client'
import { useAction } from '@/composables/useAction'

describe('useAction', () => {
  it('shows progress while running and returns the result', async () => {
    let finish: (value: string) => void = () => undefined
    const action = useAction(
      (name: string) =>
        new Promise<string>(
          (resolve) =>
            (finish = (value) => {
              resolve(`${name} ${value}`)
            }),
        ),
    )
    const pending = action.run('Alex')
    expect(action.busy.value).toBe(true)
    finish('done')
    await expect(pending).resolves.toBe('Alex done')
    expect(action.busy.value).toBe(false)
    expect(action.error.value).toBeNull()
  })

  it('keeps the message, code and field errors of an API failure', async () => {
    const action = useAction(() =>
      Promise.reject(
        new ApiError(422, 'Check it.', { code: 'invalid', fields: { email: 'Bad.' } }),
      ),
    )
    await expect(action.run()).resolves.toBeUndefined()
    expect(action.error.value).toBe('Check it.')
    expect(action.code.value).toBe('invalid')
    expect(action.fields.value).toEqual({ email: 'Bad.' })
    action.clear()
    expect([action.error.value, action.code.value, action.fields.value]).toEqual([null, null, {}])
  })

  it('reports other failures without a code', async () => {
    const action = useAction(() => Promise.reject(new Error('Boom.')))
    await action.run()
    expect([action.error.value, action.code.value, action.fields.value]).toEqual([
      'Boom.',
      null,
      {},
    ])
  })

  it('says nothing when the person declined to confirm it was them', async () => {
    const action = useAction(() =>
      Promise.reject(new ApiError(403, 'Confirm it.', { code: 'verification_required' })),
    )
    await action.run()
    expect(action.error.value).toBeNull()
    expect(action.busy.value).toBe(false)
  })
})
