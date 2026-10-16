import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import { createApplyPartyRoute, partyRouteEntries } from './sessionPartyRoute'

const room = (): UiSession =>
  ({
    id: 's1',
    agents: [
      {
        agentId: 'builtin:localix',
        handle: 'localix',
        providerConnectionId: 'conn-openai',
        modelId: 'openai/gpt-6.1-sol',
        reasoningEffort: 'high',
      },
      {
        agentId: 'frontend',
        handle: 'frontend',
        providerConnectionId: 'conn-or',
        modelId: 'openrouter/anthropic/claude-haiku-5.5',
        reasoningEffort: 'low',
      },
      {
        agentId: 'qa',
        handle: 'qa',
        providerConnectionId: null,
        modelId: '',
        reasoningEffort: 'medium',
      },
    ],
  }) as UiSession

function harness() {
  let state = {
    sessions: [room()],
    allSessions: [room()],
    connections: [{ id: 'conn-openai', providerId: 'openai', label: 'OpenAI' }],
    _replaceSession: (next: UiSession) => {
      state = { ...state, sessions: [next], allSessions: [next] }
    },
  }
  const customSet = (patch: unknown) => {
    const next =
      typeof patch === 'function'
        ? (patch as (value: typeof state) => Partial<typeof state>)(state)
        : (patch as Partial<typeof state>)
    state = { ...state, ...next }
  }
  const apply = createApplyPartyRoute({
    customSet: customSet as never,
    get: () => state as never,
    lane: new Map(),
  })
  return { apply, agents: () => state.sessions[0]!.agents }
}

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('applyPartyRoute — the whole room on one model', () => {
  test('a model choice names every member; a level-only choice leaves models alone', () => {
    const agents = room().agents
    expect(
      partyRouteEntries(agents, {
        providerConnectionId: 'conn-openai',
        modelId: 'openai/gpt-6.1-sol',
        reasoningEffort: 'high',
      }).map((entry) => [entry.agentId, entry.modelId, entry.reasoningEffort]),
    ).toEqual([
      ['builtin:localix', 'openai/gpt-6.1-sol', 'high'],
      ['frontend', 'openai/gpt-6.1-sol', 'high'],
      ['qa', 'openai/gpt-6.1-sol', 'high'],
    ])
    expect(partyRouteEntries(agents, { reasoningEffort: 'low' })[1]).toEqual({
      agentId: 'frontend',
      reasoningEffort: 'low',
    })
  })

  test('paints every member at once, then persists ONE batch patch', async () => {
    const patches: unknown[] = []
    const remember = spyOn(useUserSettings.getState(), 'update').mockImplementation(() => {})
    const update = spyOn(backendClient, 'updateSession').mockImplementation((async (
      _id: string,
      patch: { routes: { agentId: string }[] },
    ) => {
      patches.push(patch)
      return {
        ...room(),
        agents: room().agents.map((member) => ({
          ...member,
          providerConnectionId: 'conn-openai',
          modelId: 'openai/gpt-6.1-sol',
          reasoningEffort: 'high',
        })),
      }
    }) as never)
    restore = () => {
      update.mockRestore()
      remember.mockRestore()
    }
    const { apply, agents } = harness()
    const pending = apply('s1', {
      providerConnectionId: 'conn-openai',
      modelId: 'openai/gpt-6.1-sol',
      reasoningEffort: 'high',
    })
    // Optimistic: the picker reads the room before the round-trip completes.
    expect(agents().map((member) => member.modelId)).toEqual([
      'openai/gpt-6.1-sol',
      'openai/gpt-6.1-sol',
      'openai/gpt-6.1-sol',
    ])
    await pending
    expect(update).toHaveBeenCalledTimes(1)
    expect((patches[0] as { routes: unknown[] }).routes).toHaveLength(3)
    expect(agents().every((member) => member.reasoningEffort === 'high')).toBe(true)
  })

  test('a refused batch puts every member back where it was', async () => {
    const update = spyOn(backendClient, 'updateSession').mockImplementation((async () => {
      throw new Error('agent_unavailable')
    }) as never)
    restore = () => update.mockRestore()
    const { apply, agents } = harness()
    await expect(
      apply('s1', { providerConnectionId: 'conn-openai', modelId: 'x/y', reasoningEffort: 'max' }),
    ).rejects.toThrow('agent_unavailable')
    expect(agents()).toEqual(room().agents)
  })
})
