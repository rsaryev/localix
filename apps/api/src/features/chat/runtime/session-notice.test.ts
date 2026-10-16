import { describe, expect, test } from 'bun:test'

import {
  participantsChangeText,
  permissionModeChangeNotice,
  recordSessionNotice,
  routeChangeNotices,
} from './session-notice'
import type { AgentStreamEvent, PersistedMessage } from '../contracts'
import type { SessionAgentRoute } from '../repository-types'

const member = (over: Partial<SessionAgentRoute>): SessionAgentRoute =>
  ({
    agentId: 'a1',
    handle: 'lead',
    providerConnectionId: 'c1',
    modelId: 'anthropic/claude-opus-5',
    reasoningEffort: 'medium',
    ...over,
  }) as SessionAgentRoute

describe('what a conversation says about itself', () => {
  test('a membership change names who came and who went', () => {
    expect(
      participantsChangeText([member({})], [member({}), member({ agentId: 'a2', handle: 'qa' })]),
    ).toBe('qa joined the conversation.')
    expect(
      participantsChangeText([member({}), member({ agentId: 'a2', handle: 'qa' })], [member({})]),
    ).toBe('qa left the conversation.')
    expect(participantsChangeText([member({})], [member({})])).toBeNull()
  })

  test('a route change names the PARTICIPANT it is about', () => {
    // The defect this replaces: "Reasoning effort set to low", with nothing saying whose. In a
    // room of three that sentence is about one of them and reads as being about all of them.
    const before = [member({}), member({ agentId: 'a2', handle: 'qa' })]
    const after = [member({ reasoningEffort: 'low' }), member({ agentId: 'a2', handle: 'qa' })]
    expect(routeChangeNotices(before, after)).toEqual([
      {
        kind: 'reasoning_change',
        tone: 'neutral',
        participant: 'lead',
        text: 'lead reasoning effort set to low.',
      },
    ])
  })

  test('a model change is reported without its provider prefix', () => {
    expect(routeChangeNotices([member({})], [member({ modelId: 'openai/gpt-5' })])).toEqual([
      { kind: 'model_change', tone: 'neutral', participant: 'lead', text: 'lead is now on gpt-5.' },
    ])
  })

  test('a newcomer’s model is not a change — the join line already said they are here', () => {
    expect(routeChangeNotices([], [member({})])).toEqual([])
  })

  test('nothing is announced when nothing moved', () => {
    expect(routeChangeNotices([member({})], [member({})])).toEqual([])
  })

  test('a mode line carries the mode it switched TO, so the client can draw that mode', () => {
    // Without the field every mode line rendered as the same shield: a switch to Autonomous
    // looked like a switch back to Default.
    expect(permissionModeChangeNotice('default', 'autonomous')).toMatchObject({
      kind: 'permission_mode_change',
      mode: 'autonomous',
    })
    expect(permissionModeChangeNotice('plan', 'plan')).toBeNull()
    expect(permissionModeChangeNotice('plan', undefined)).toBeNull()
  })
})

test('the visible line is UI-only and its agent context is carried by a binding', async () => {
  const written: PersistedMessage[] = []
  const published: AgentStreamEvent[] = []
  await recordSessionNotice(
    {
      repo: {
        insertMessage: async (message) => {
          written.push(message)
        },
      },
      streamRegistry: { publish: (_userId, _sessionId, event) => published.push(event) },
      now: () => '2026-09-18 10:00:00',
    },
    'u1',
    's1',
    {
      kind: 'reasoning_change',
      tone: 'neutral',
      participant: 'lead',
      text: 'lead reasoning effort set to low.',
    },
  )

  const [row] = written
  expect(row).toBeDefined()
  expect(row!.payload.role).toBe('user')
  expect(row!.payload.content).toBe('lead reasoning effort set to low.')
  expect(row!.payload.uiOnly).toBe(true)
  expect(row!.payload.bindings?.[0]).toMatchObject({
    kind: 'context',
    source: 'system',
    target: {
      kind: 'system-event',
      token: 'notice:reasoning_change:participant:lead',
    },
    resolution: {
      status: 'resolved',
      contributions: [{ content: 'lead reasoning effort set to low.' }],
    },
  })
  expect(published.map((event) => event.type)).toEqual(['message.created'])
})
