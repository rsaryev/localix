import { describe, expect, test } from 'bun:test'
import { resolveSessionAgent, type ResolveSessionAgent } from './session-agent-selection'

describe('session agent assignment', () => {
  test('a new name selection persists the resolved identity and canonical display snapshot', async () => {
    const calls: unknown[] = []
    const resolve: ResolveSessionAgent = async (...args) => {
      calls.push(args)
      return { id: 'native:project:p:original', name: 'reviewer' }
    }
    expect(
      await resolveSessionAgent({
        userId: 'u',
        projectId: 'p',
        requested: { name: 'reviewer', modelId: 'model' },
        resolve,
      }),
    ).toEqual({
      agentId: 'native:project:p:original',
      name: 'reviewer',
      modelId: 'model',
    })
    expect(calls).toEqual([['u', { name: 'reviewer', modelId: 'model' }, 'p', undefined]])
  })

  test('an unavailable ID is never retried as its display name', async () => {
    const calls: unknown[] = []
    const resolve: ResolveSessionAgent = async (_userId, selection) => {
      calls.push(selection)
      return selection.agentId ? null : { id: 'replacement', name: 'reviewer' }
    }
    await expect(
      resolveSessionAgent({
        userId: 'u',
        projectId: null,
        requested: { agentId: 'deleted', name: 'reviewer' },
        resolve,
      }),
    ).rejects.toThrow('unavailable')
    expect(calls).toEqual([{ agentId: 'deleted', name: 'reviewer' }])
  })

  test('the default is an explicit builtin ID and standalone hosts cannot invent custom agents', async () => {
    expect(await resolveSessionAgent({ userId: 'u', projectId: null })).toEqual({
      agentId: 'builtin:localix',
      name: 'localix',
    })
    await expect(
      resolveSessionAgent({ userId: 'u', projectId: null, requested: { name: 'unknown' } }),
    ).rejects.toThrow('unavailable')
  })
})
