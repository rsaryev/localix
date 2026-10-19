import { sessionFixture } from '../../../testing/session-fixture'
import { describe, expect, test } from 'bun:test'
import { createRunMacroCommand } from './run-macro'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import type { AgentTurnAdmission } from '../runtime/agent-turn-ticket'
import { noLeadership } from '../runtime/conversation-strategy'

function harness(opts: { busy?: boolean } = {}) {
  const woken: unknown[] = []
  const inserted: PersistedMessage[] = []
  const events: Array<{ type: string; message?: PersistedMessage }> = []
  let updatedSession: SessionRecord | null = null
  let currentSession: SessionRecord = session
  let runArgs: AgentTurnAdmission | null = null
  const run = createRunMacroCommand({
    repo: {
      insertMessage: async (m: PersistedMessage) => {
        inserted.push(m)
      },
      seedSessionTopic: async (_u: string, _id: string, title: string, goal: string | null) => {
        currentSession = { ...currentSession, title, goal }
      },
      updateSession: async (_u: string, _s: string, patch: Partial<SessionRecord>) => {
        currentSession = { ...currentSession, ...patch }
        updatedSession = currentSession
      },
      getSession: async () => currentSession,
    } as never,
    streamRegistry: {
      publish: (_u: string, _s: string, e: { type: string }) => {
        events.push(e as never)
      },
    } as never,
    publishSession: () => {},
    runner: {
      enqueueRun: async (args: AgentTurnAdmission) => {
        runArgs = args
      },
      isBusy: () => opts.busy === true,
      cancelAgentTurns: async () => {},
      leadership: () => noLeadership,
      floorAdvisor: () => async () => null,
      wake: async (params: unknown) => {
        woken.push(params)
      },
    } as never,
  })
  return {
    run,
    inserted,
    events,
    woken,
    get updatedSession() {
      return updatedSession
    },
    get runArgs() {
      return runArgs
    },
  }
}

const session = { ...sessionFixture(), title: 'New Chat', id: 's' } as unknown as SessionRecord
describe('runMacroCommand', () => {
  test('persists one visible user turn with an invocation binding plus an empty assistant', async () => {
    const h = harness()
    await h.run(
      'u',
      's',
      session,
      [],
      '/sample-command',
      'Please review the diff thoroughly.',
      '2026-01-01',
    )

    expect(h.inserted).toHaveLength(2)
    expect(h.inserted[0].payload).toMatchObject({ role: 'user', content: '/sample-command' })
    expect(h.inserted[0].payload.bindings?.[0]).toMatchObject({
      kind: 'invocation',
      source: 'slash',
      presentation: { label: '/sample-command', token: '/sample-command' },
      instruction: 'Please review the diff thoroughly.',
    })
    expect(h.inserted[1].payload).toMatchObject({ role: 'assistant', content: '' })
    expect(h.events.map((e) => e.type)).toEqual(['message.created', 'message.created'])
  })

  test('derives the title from the VISIBLE prompt and returns the assistant slot id', async () => {
    const h = harness()
    const res = await h.run('u', 's', session, [], '/usage', 'Show token usage.', '2026-01-02')
    expect(h.updatedSession?.title).toBe('/usage') // autoTitle uses the visible user message, not the hidden one
    expect(res.messageId).toBe(h.inserted[1].id)
  })

  test('queues one addressed run with the bound user turn and assistant slot', async () => {
    const h = harness()
    await h.run('u', 's', session, [], '/x', 'do x', '2026-01-03')
    const [userRow, slot] = h.inserted
    expect(userRow?.payload.content).toBe('/x')
    expect(userRow?.payload.bindings?.[0]).toMatchObject({
      kind: 'invocation',
      instruction: 'do x',
    })
    // The turn is anchored by its trigger row; the dispatcher reads the history itself.
    expect(h.runArgs?.triggerMessageIds).toEqual([userRow!.id])
    expect(h.runArgs).not.toHaveProperty('historyMessages')
    expect(h.runArgs?.assistantMessageId).toBe(slot!.id)
    expect(h.runArgs?.scope.speakerAgentId).toBe(session.agents[0]!.agentId)
  })

  test('publishes the user echo before loading history', async () => {
    const h = harness()
    const prior = {
      id: 'prior',
      payload: { id: 'prior', role: 'user', content: 'before' },
    } as unknown as PersistedMessage
    let insertsAtLoad = -1

    await h.run(
      'u',
      's',
      session,
      async () => {
        insertsAtLoad = h.inserted.length
        return [prior, ...h.inserted]
      },
      '/x',
      'do x',
      '2026-01-03',
    )

    expect(insertsAtLoad).toBe(1)
    expect(h.runArgs?.triggerMessageIds).toEqual([h.inserted[0]!.id])
  })

  test('preserves the initiating client surface on the macro run', async () => {
    const h = harness()
    const toolSurface = {
      capabilities: ['workbench-ui'],
      catalogs: { 'workbench-ui': 'ui1_macro' },
    }
    await h.run('u', 's', session, [], '/x', 'do x', '2026-01-03', { toolSurface })

    expect(h.runArgs?.scope.executionContext).toMatchObject({
      invocation: { kind: 'root' },
      clientSurface: toolSurface,
    })
  })

  test('passes extra tool overrides through only when non-empty', async () => {
    const h = harness()
    await h.run('u', 's', session, [], '/x', 'do x', '2026-01-04', {
      extraDisabledTools: ['bash'],
      extraAllowedTools: [],
      requiredTools: [{ name: 'plugin_build' }],
    })
    expect(h.runArgs?.scope.extraDisabledTools).toEqual(['bash'])
    expect(h.runArgs?.scope.requiredTools).toEqual([{ name: 'plugin_build' }])
    expect(h.runArgs?.scope).not.toHaveProperty('extraAllowedTools') // empty array omitted
  })

  test('persists additional bindings on the same visible command turn', async () => {
    const h = harness()
    const binding = {
      kind: 'context' as const,
      id: 'r1',
      source: 'mention' as const,
      target: {
        kind: 'resource',
        token: '@resource:localix://resource/fixture-db/c/users',
        label: 'users',
      },
      resolution: { status: 'empty' as const, contributions: [] },
    }
    await h.run('u', 's', session, [], '/sample-command', 'review it', '2026-01-05', {
      bindings: [binding],
    })
    expect(h.inserted[0].payload.bindings?.[1]).toEqual(binding)
  })

  test('a busy session queues the command whole instead of writing into the running turn', async () => {
    const h = harness({ busy: true })
    const res = await h.run('u', 's', session, [], '/sample-command', 'review it', '2026-01-06', {
      commandOrigin: { command: '/sample-command', label: 'skill' },
      extraAllowedTools: ['bash'],
      requiredTools: [{ name: 'plugin_build' }],
      modelId: 'fast-model',
    })
    expect(res).toMatchObject({ queued: true })
    expect(h.inserted).toEqual([])
    expect(h.woken).toMatchObject([
      {
        content: '/sample-command',
        internal: false,
        source: 'user-busy',
        bindings: [{ kind: 'invocation', instruction: 'review it' }],
        command: {
          origin: { command: '/sample-command', label: 'skill' },
          identity: {
            extraAllowedTools: ['bash'],
            requiredTools: [{ name: 'plugin_build' }],
            modelOverride: 'fast-model',
          },
        },
      },
    ])
  })

  test('a command addressed to nobody goes to the leader, whoever answered last', async () => {
    // The strategy reads the transcript's last row as "who answered the user last"; with the
    // command's own row counted, that rule never matched and the turn went elsewhere.
    const room = sessionFixture({
      id: 's',
      agents: [
        {
          agentId: 'a',
          handle: 'a',
          providerConnectionId: null,
          modelId: 'm',
          reasoningEffort: 'medium',
        },
        {
          agentId: 'b',
          handle: 'b',
          providerConnectionId: null,
          modelId: 'm',
          reasoningEffort: 'medium',
        },
      ],
    })
    const answeredByA = (id: string) =>
      ({
        id,
        payload: { id, role: 'assistant', from: 'agent:a', to: 'user', content: 'hi' },
      }) as unknown as PersistedMessage
    const answeredByB = {
      id: 'b1',
      payload: { id: 'b1', role: 'assistant', from: 'agent:b', to: 'user', content: 'done' },
    } as unknown as PersistedMessage
    const h = harness()
    await h.run('u', 's', room, [answeredByA('a1'), answeredByB], '/x', 'do x', '2026-01-07')
    expect(h.runArgs?.scope.speakerAgentId).toBe('a')
  })
})
