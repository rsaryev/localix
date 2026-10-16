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
    expect(await reseatParticipants({ agents: existing }, next)).toEqual(existing)
  })

  test('a newcomer inherits nobody’s route — its seat is decided once, for itself', async () => {
    // Neither the agent it replaces by handle nor the member sitting first.
    const first = routedParticipants({
      agentId: 'first',
      handle: 'first',
      modelId: 'seed',
      reasoningEffort: 'max',
    })[0]
    const old = routedParticipants({
      agentId: 'old',
      handle: 'reviewer',
      modelId: 'private-model',
      reasoningEffort: 'high',
    })[0]
    const asked: unknown[] = []
    const seated = await reseatParticipants(
      { agents: [first, old], userId: 'u', projectId: 'p' },
      [{ agentId: 'new', handle: 'reviewer' }],
      async (_userId, _projectId, agentId, given) => {
        asked.push({ agentId, given })
        return {
          providerConnectionId: 'conn',
          modelId: 'card/model',
          reasoningEffort: 'low',
          modelOrigin: 'agent',
        }
      },
    )
    expect(seated).toEqual([
      {
        agentId: 'new',
        handle: 'reviewer',
        providerConnectionId: 'conn',
        modelId: 'card/model',
        reasoningEffort: 'low',
        modelOrigin: 'agent',
      },
    ])
    expect(asked).toEqual([{ agentId: 'new', given: { chosen: null } }])
  })

  test('a newcomer joins on the session’s choice for it, else the chain decides', async () => {
    const first = routedParticipants({ agentId: 'first', handle: 'first', modelId: 'seed' })[0]
    const asked: unknown[] = []
    const seat = async (
      _userId: string,
      _projectId: string | null,
      agentId: string,
      given?: { chosen?: unknown },
    ) => {
      asked.push({ agentId, chosen: given?.chosen })
      return {
        providerConnectionId: 'c',
        modelId: 'chosen',
        reasoningEffort: 'low' as const,
        modelOrigin: 'session' as const,
      }
    }
    const own = {
      providerConnectionId: null,
      modelId: 'own/model',
      reasoningEffort: 'max' as const,
    }
    await reseatParticipants(
      {
        agents: [first],
        userId: 'u',
        projectId: 'p',
        modelChoices: { agents: { picked: own } },
      },
      [first, { agentId: 'picked', handle: 'picked' }, { agentId: 'later', handle: 'later' }],
      seat,
    )
    expect(asked).toEqual([
      { agentId: 'picked', chosen: own },
      { agentId: 'later', chosen: null },
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
