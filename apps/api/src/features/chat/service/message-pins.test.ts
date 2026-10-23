import { describe, expect, test } from 'bun:test'

import { setMessagePinned } from './message-pins'

function io(payload: Record<string, unknown>) {
  const updates: unknown[] = []
  const published: unknown[] = []
  let stored = { id: 'm1', role: 'assistant', ...payload }
  return {
    updates,
    published,
    io: {
      repo: {
        getMessage: async () => ({ id: 'm1', createdAt: 't0', payload: stored }),
        updateMessage: async (_u: string, _s: string, _id: string, patch: object) => {
          updates.push(patch)
          stored = { ...stored, ...patch }
          return { payload: stored }
        },
      },
      streamRegistry: { publish: (...args: unknown[]) => published.push(args) },
      now: () => 't1',
    } as never,
  }
}

const pin = (h: ReturnType<typeof io>, pinned: boolean) =>
  setMessagePinned(h.io, { userId: 'u', sessionId: 's', messageId: 'm1', pinned })

describe('pinning a message', () => {
  test('stores the pin on the message and publishes the row', async () => {
    const h = io({})
    expect(await pin(h, true)).toBe(true)
    expect(h.updates).toEqual([{ pinned: true }])
    expect(h.published).toHaveLength(1)
  })

  test('unpinning clears the field', async () => {
    const h = io({ pinned: true })
    expect(await pin(h, false)).toBe(true)
    expect(h.updates).toEqual([{ pinned: undefined }])
  })

  test('the same state again writes nothing', async () => {
    const h = io({ pinned: true })
    expect(await pin(h, true)).toBe(false)
    expect(h.updates).toEqual([])
    expect(h.published).toEqual([])
  })
})
