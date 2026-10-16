import { describe, expect, it } from 'bun:test'
import { acquireUnlessAborted } from './acquire-unless-aborted'

describe('acquireUnlessAborted', () => {
  it('does not acquire when the request is already cancelled', async () => {
    const controller = new AbortController()
    const reason = new Error('already cancelled')
    controller.abort(reason)
    let acquired = false

    expect(
      acquireUnlessAborted(async () => {
        acquired = true
        return {}
      }, controller.signal),
    ).rejects.toBe(reason)
    expect(acquired).toBe(false)
  })

  it('releases a resource acquired after cancellation instead of starting work on it', async () => {
    const controller = new AbortController()
    const reason = new Error('timed out while waiting')
    let resolve!: (resource: { id: number }) => void
    const acquisition = new Promise<{ id: number }>((done) => {
      resolve = done
    })
    let released: { id: number } | undefined

    const pending = acquireUnlessAborted(
      () => acquisition,
      controller.signal,
      (resource) => {
        released = resource
      },
    )
    controller.abort(reason)
    resolve({ id: 7 })

    expect(pending).rejects.toBe(reason)
    expect(released).toEqual({ id: 7 })
  })
})
