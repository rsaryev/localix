import { describe, expect, test } from 'bun:test'
import { resolveSessionParticipants, type ResolveSessionAgent } from './session-agent-selection'
import { reseatParticipants } from './participant-routes'
import { routedParticipants } from '../../../testing/session-fixture'

describe('session agent assignment', () => {
  test('a new handle selection persists the resolved identity and canonical display snapshot', async () => {
    const calls: unknown[] = []
    const resolve: ResolveSessionAgent = async (...args) => {
      calls.push(args)
      return { id: 'native:project:p:original', handle: 'reviewer' }
    }
    expect(
      await resolveSessionParticipants({
        userId: 'u',
        projectId: 'p',
        requested: [{ handle: 'reviewer', modelId: 'model' }],
        resolve,
      }),
    ).toEqual([
      {
        agentId: 'native:project:p:original',
        handle: 'reviewer',
        modelId: 'model',
      },
    ])
    expect(calls).toEqual([['u', { handle: 'reviewer', modelId: 'model' }, 'p']])
  })

  test('an unavailable ID is never retried as its display handle', async () => {
    const calls: unknown[] = []
    const resolve: ResolveSessionAgent = async (_userId, selection) => {
      calls.push(selection)
      return selection.agentId ? null : { id: 'replacement', handle: 'reviewer' }
    }
    await expect(
      resolveSessionParticipants({
        userId: 'u',
        projectId: null,
        requested: [{ agentId: 'deleted', handle: 'reviewer' }],
        resolve,
      }),
    ).rejects.toThrow('unavailable')
    expect(calls).toEqual([{ agentId: 'deleted', handle: 'reviewer' }])
  })

  test('editing membership retains historical snapshots without authorizing a deleted definition', async () => {
    const existing = routedParticipants({
      agentId: 'deleted',
      handle: 'old-name',
      modelId: 'old-model',
    })
    const resolve: ResolveSessionAgent = async () => {
      throw new Error('must not reassign')
    }
    const next = await resolveSessionParticipants({
      userId: 'u',
      projectId: null,
      existing,
      requested: [{ agentId: 'deleted', handle: 'forged-name' }],
      resolve,
    })
    expect(reseatParticipants({ agents: existing }, next)).toEqual(existing)
  })

  test('a newcomer inherits nobody’s model — only the room’s effort', () => {
    // Neither the agent it replaces by handle nor the member sitting first: a seat born holding
    // someone else's model is both wrong and unrecoverable, because a stored model reads as a
    // choice and stops the chain from ever answering for that participant again.
    const first = routedParticipants({ agentId: 'first', handle: 'first', modelId: 'seed' })[0]
    const old = routedParticipants({
      agentId: 'old',
      handle: 'reviewer',
      modelId: 'private-model',
      reasoningEffort: 'high',
    })[0]
    expect(
      reseatParticipants({ agents: [first, old] }, [{ agentId: 'new', handle: 'reviewer' }]),
    ).toEqual([
      {
        agentId: 'new',
        handle: 'reviewer',
        providerConnectionId: null,
        modelId: '',
        reasoningEffort: first.reasoningEffort,
      },
    ])
  })

  test('an empty draft is allowed while duplicate participants are refused', async () => {
    expect(
      await resolveSessionParticipants({ userId: 'u', projectId: null, requested: [] }),
    ).toEqual([])
    await expect(
      resolveSessionParticipants({
        userId: 'u',
        projectId: null,
        requested: [{ agentId: 'builtin:localix' }, { handle: 'localix' }],
      }),
    ).rejects.toThrow('already a participant')
  })

  test('the default is an explicit builtin ID and standalone hosts cannot invent custom agents', async () => {
    expect(await resolveSessionParticipants({ userId: 'u', projectId: null })).toEqual([
      { agentId: 'builtin:localix', handle: 'localix' },
    ])
    await expect(
      resolveSessionParticipants({
        userId: 'u',
        projectId: null,
        requested: [{ handle: 'unknown' }],
      }),
    ).rejects.toThrow('unavailable')
  })
})
