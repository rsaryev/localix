import { describe, expect, test } from 'bun:test'
import { cancellableSleep } from './device-code'

describe('a sign-in wait the person can cancel', () => {
  test('a wait asked for after cancelling is refused as cancelled', async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(cancellableSleep(60_000, stop.signal)).rejects.toThrow('Login cancelled')
  })

  test('cancelling during the wait ends it as cancelled at once', async () => {
    const stop = new AbortController()
    const waiting = cancellableSleep(60_000, stop.signal)
    stop.abort()
    await expect(waiting).rejects.toThrow('Login cancelled')
  })

  test('a wait with nothing to cancel it ends on time', async () => {
    await expect(cancellableSleep(0, undefined)).resolves.toBeUndefined()
  })
})
