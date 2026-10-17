import { sessionFixture } from '../../../testing/session-fixture'
import { describe, expect, test } from 'bun:test'
import { createRunAgent, resolveExistingMessages } from './run-agent'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import { ORCHESTRATION_DELEGATE_TASK, childExecutionContext } from '../runtime/execution-context'
import type { AgentTurnAdmission } from '../runtime/agent-turn-ticket'
import { noLeadership } from '../runtime/conversation-strategy'

function harness(
  initialSession: SessionRecord = session,
  inviteAddressed: (
    userId: string,
    session: SessionRecord,
    text: string,
  ) => Promise<SessionRecord> = async (_userId, current) => current,
) {
  let currentSession: SessionRecord = initialSession
  const inserted: PersistedMessage[] = []
  const events: Array<{ type: string; message?: PersistedMessage }> = []
  let runArgs: AgentTurnAdmission | null = null
  const runAgent = createRunAgent({
    repo: {
      insertMessage: async (m: PersistedMessage) => {
        inserted.push(m)
      },
      seedSessionTopic: async (_u: string, _id: string, title: string, goal: string | null) => {
        currentSession = { ...currentSession, title, goal }
      },
      updateSession: async (_u: string, _id: string, patch: Partial<SessionRecord>) => {
        currentSession = { ...currentSession, ...patch }
      },
      getSession: async () => currentSession,
    } as never,
    streamRegistry: {
      publish: (_u: string, _s: string, e: { type: string }) => {
        events.push(e as never)
      },
    } as never,
    publishSession: () => {},
    maybeGenerateTitle: () => {},
    runner: {
      cancelAgentTurns: async () => {},
      leadership: () => noLeadership,
      // An invitation persists the roster, so the repository sees it from then on.
      inviteAddressed: async (userId: string, current: SessionRecord, text: string) => {
        currentSession = await inviteAddressed(userId, current, text)
        return currentSession
      },
      enqueueRun: async (args: AgentTurnAdmission) => {
        runArgs = args
      },
    } as never,
  })
  return {
    runAgent,
    inserted,
    events,
    get runArgs() {
      return runArgs
    },
  }
}

const session = {
  ...sessionFixture(),
  title: 'New Chat',
  id: 's',
  sessionKind: 'chat',
} as unknown as SessionRecord

const msg = (id: string, role: 'user' | 'assistant', content: string): PersistedMessage =>
  ({
    id,
    sessionId: 's',
    userId: 'u',
    payload: { id, role, content },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }) as PersistedMessage

describe('runAgent history loader', () => {
  test('publishes the user echo BEFORE the history load completes', async () => {
    const h = harness()
    // Records the interleaving of the two things that race for the critical path: the user's
    // own echo, and the transcript read. The echo must not wait for the read; the assistant
    // slot MUST, because its author is the explicitly addressed speaker and that decision reads
    // the transcript (`floor/transcript.ts`).
    const order: string[] = []
    let resolveLoad: (() => void) | undefined
    const gate = new Promise<void>((r) => {
      resolveLoad = r
    })

    const publish = h.events
    const loader = async () => {
      order.push('load:start')
      await gate
      order.push('load:done')
      return []
    }

    const running = h.runAgent('u', 's', session, loader, 'hi', '2026-01-01')

    // Let the insert/publish microtasks drain while the load is still gated.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    // The echo is already out even though the history has NOT loaded yet — this is
    // the whole point of the loader form. The assistant slot is not: who speaks first is read
    // off the transcript, so its row is minted once the transcript is in.
    expect(publish.map((e) => e.type)).toEqual(['message.created'])
    expect(publish[0].message?.payload.role).toBe('user')
    expect(publish[0].message?.payload.content).toBe('hi')
    expect(order).not.toContain('load:done')

    resolveLoad!()
    await running
    expect(order).toEqual(['load:start', 'load:done'])
    expect(publish.map((e) => e.message?.payload.role)).toEqual(['user', 'assistant'])
  })

  test('preserves the user → assistant message.created order', async () => {
    const h = harness()
    await h.runAgent('u', 's', session, async () => [], 'hello', '2026-01-01')

    expect(h.events.map((e) => e.type)).toEqual(['message.created', 'message.created'])
    expect(h.events.map((e) => e.message?.payload.role)).toEqual(['user', 'assistant'])
    // The assistant slot the caller is told to stream into is the one published second.
    expect(h.events[1].message?.payload.content).toBe('')
  })

  test('persists the optimistic row correlation on an immediate user turn', async () => {
    const h = harness()
    await h.runAgent('u', 's', session, [], 'hello', '2026-01-01', undefined, {
      clientMessageId: 'optimistic-user-1',
    })

    expect(h.inserted[0]?.payload.clientMessageIds).toEqual(['optimistic-user-1'])
    expect(h.events[0]?.message?.payload.clientMessageIds).toEqual(['optimistic-user-1'])
  })

  test('drops the rows this turn inserted from the loader result', async () => {
    // A post-insert load sees the turn's own rows at the tail; the turn's history is the
    // transcript before them.
    const earlier = msg('m1', 'user', 'earlier')
    const reply = msg('a1', 'assistant', 'done')
    const loaded = await resolveExistingMessages(
      async () => [earlier, reply, msg('u2', 'user', 'now'), msg('a2', 'assistant', '')],
      ['u2', 'a2'],
    )
    expect(loaded.map((row) => row.id)).toEqual(['m1', 'a1'])
  })

  test('enqueues the turn by its trigger row, with no history attached', async () => {
    // The dispatcher re-reads the transcript when the ticket runs, so the enqueue input states
    // only which row opened the turn. The reply anchors after the user row — never after the
    // assistant slot this turn minted, and never after a prior row.
    const h = harness()
    await h.runAgent('u', 's', session, [msg('m1', 'user', 'earlier')], 'now', '2026-01-01')

    const [userRow, slot] = h.inserted
    expect(userRow?.payload.content).toBe('now')
    expect(h.runArgs?.triggerMessageIds).toEqual([userRow!.id])
    expect(h.runArgs?.assistantMessageId).toBe(slot!.id)
    expect(h.runArgs).not.toHaveProperty('historyMessages')
  })

  test('persists typed loop-subsession provenance and forwards leaf authority', async () => {
    const h = harness()
    const executionContext = childExecutionContext({
      kind: 'loop-subsession',
      parentSessionId: 'parent',
      loopId: 'loop-1',
    })
    await h.runAgent('u', 's', session, [], 'tick', '2026-01-01', undefined, {
      executionContext,
      isInternal: true,
    })

    expect(h.inserted[0]?.payload.origin).toBe('loop')
    expect(h.runArgs?.scope.executionContext).toEqual(executionContext)
  })

  test('a normal root run receives spawn-child authority by default', async () => {
    const h = harness()
    await h.runAgent('u', 's', session, [], 'hello', '2026-01-01')

    const context = h.runArgs?.scope.executionContext as {
      invocation: { kind: string }
      authority: { capabilities: string[] }
    }
    expect(context.invocation.kind).toBe('root')
    expect(context.authority.capabilities).toContain(ORCHESTRATION_DELEGATE_TASK)
  })
})

describe('a tag in the person’s message', () => {
  test('brings an available agent in before the message is routed to it', async () => {
    const qa = {
      agentId: 'native:global:qa',
      handle: 'qa',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    } as SessionRecord['agents'][number]
    const seen: string[] = []
    const h = harness(session, async (_userId, current, text) => {
      seen.push(text)
      return { ...current, agents: [...current.agents, qa] }
    })
    await h.runAgent('u', 's', session, [], '@qa, check the login flow', '2026-01-01')
    expect(seen).toEqual(['@qa, check the login flow'])
    expect(h.runArgs?.scope.speakerAgentId).toBe('native:global:qa')
  })
})
