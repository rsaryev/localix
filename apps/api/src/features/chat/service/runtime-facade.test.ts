import { describe, expect, test } from 'bun:test'

import { createChatRuntimeFacade, type ChatRuntimeFacadeDeps } from './runtime-facade'

/** The person's Stop returns their queue only to the session's owner. */
function facade(owner: string) {
  const calls: string[] = []
  const returned = [{ content: 'queued question' }]
  const runner = {
    stopAndReturnQueued: async (userId: string, sessionId: string) => {
      calls.push(`${userId}:${sessionId}`)
      return { stopped: true, returned }
    },
  }
  const deps = {
    repo: {},
    runner,
    withSessionMutationLock: async <T>(_id: string, work: () => Promise<T>) => work(),
    requireSession: async (userId: string) => {
      if (userId !== owner) throw new Error('not found')
      return {}
    },
  } as unknown as ChatRuntimeFacadeDeps
  return { calls, returned, runtime: createChatRuntimeFacade(deps) }
}

describe('stopAndReturnQueued', () => {
  test('the owner stops the run and gets their queued messages back', async () => {
    const { runtime, calls, returned } = facade('alice')
    expect(await runtime.stopAndReturnQueued('s1', 'alice')).toEqual({ stopped: true, returned })
    expect(calls).toEqual(['alice:s1'])
  })

  test('another user stops nothing and is handed nothing, and the queue is never touched', async () => {
    const { runtime, calls } = facade('alice')
    expect(await runtime.stopAndReturnQueued('s1', 'mallory')).toEqual({
      stopped: false,
      returned: [],
    })
    expect(calls).toEqual([])
  })
})
