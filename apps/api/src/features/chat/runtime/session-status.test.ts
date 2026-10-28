import type { AgentItemStatus } from '@localixai/agent/agents'

import { describe, expect, test } from 'bun:test'

import type { ChatRepository, SessionRecord } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import type { LiveItemResolver } from './agent-runner-state'
import { markRuntimeSessionStatus, publishChildSummary } from './session-status'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

const NOW = '2026-06-16T15:30:00.000Z'

/**
 * A running sub-agent, stated as the few fields this suite is actually about.
 *
 * It used to spell out 22 fields and close with `as SessionRecord`, so it READ as complete while
 * silently missing several (`archivedAt` among them). That is the dangerous shape:
 * an obvious one-line stub (`{ id: 's1' } as SessionRecord`) is an honest narrow harness and
 * announces itself, but a fixture that looks exhaustive and is not invites every reader to trust
 * it. The cast went first; the remaining twenty uninteresting fields have now gone to
 * `testing/session-fixture`, where the record's shape is stated once for every suite that needs
 * one — which is what stops the next added field from breaking fifteen files at once.
 */
function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return sessionFixture({
    id: 'child-1',
    userId: 'u',
    title: 'sub',
    agent: routedAgent({ modelId: 'm', reasoningEffort: 'off' }),
    // This fixture used to carry an `agentMode: 'code'` — a value no mode union ever held,
    // which type-checked only because of an `as SessionRecord` cast. Modes are gone; the
    // named accessor below is what keeps a fixture from drifting out of the record type again.
    createdAt: '2026-06-16T10:00:00.000Z',
    updatedAt: '2026-06-16T10:00:00.000Z',
    lastMessageAt: '2026-06-16T10:00:00.000Z',
    rootSessionId: null,
    sessionKind: 'subagent',
    runtimeStatus: 'running',
    provenance: { kind: 'unknown-origin' },
    ...over,
  })
}

type Pub = { userId: string; sessionId: string; type: string }

function harness() {
  const pubs: Pub[] = []
  const updated: Partial<SessionRecord>[] = []
  let stored: SessionRecord | undefined
  const streamRegistry = {
    publish: (userId: string, sessionId: string, event: { type: string }) =>
      pubs.push({ userId, sessionId, type: event.type }),
  } as unknown as SessionStreamRegistry
  const repo = {
    updateSession: async (_u: string, _id: string, s: Partial<SessionRecord>) => {
      updated.push(s)
      if (stored) stored = { ...stored, ...s }
    },
    getSession: async () => stored,
    findActiveBranchToolCallMessage: async () => null,
    updateMessage: async () => undefined,
  } as unknown as ChatRepository
  const store = (record: SessionRecord) => {
    stored = record
  }
  return { pubs, updated, streamRegistry, repo, store }
}

function call(over: {
  h: ReturnType<typeof harness>
  session: SessionRecord
  status: SessionRecord['runtimeStatus']
  resolvers?: Map<string, LiveItemResolver>
}) {
  return markRuntimeSessionStatus({
    repo: over.h.repo,
    streamRegistry: over.h.streamRegistry,
    now: () => NOW,
    userId: 'u',
    session: over.session,
    status: over.status,
    liveItemResolvers: over.resolvers ?? new Map(),
  })
}

describe('markRuntimeSessionStatus', () => {
  test('chat-kind sessions are left untouched — no persist, no publish', async () => {
    const h = harness()
    const chat = session({ sessionKind: 'chat' })
    const res = await call({ h, session: chat, status: 'completed' })
    expect(res).toBe(chat)
    expect(h.updated).toHaveLength(0)
    expect(h.pubs).toHaveLength(0)
  })

  test('persists the new status + timestamps and publishes session.updated', async () => {
    const h = harness()
    const res = await call({ h, session: session(), status: 'completed' })
    expect(res.runtimeStatus).toBe('completed')
    expect(res.updatedAt).toBe(NOW)
    expect(res.lastMessageAt).toBe(NOW)
    expect(h.updated).toHaveLength(1)
    expect(h.pubs.map((p) => p.type)).toEqual(['session.updated'])
  })

  test('writes only the status, so changes made during the run survive it', async () => {
    const h = harness()
    // Admitted while open, then closed and renamed while it ran.
    const admitted = session({ parentSessionId: 'parent-1' })
    h.store({ ...admitted, closedAt: '2026-06-16T15:00:00.000Z', title: 'renamed' })
    const res = await call({ h, session: admitted, status: 'stopped' })
    expect(h.updated).toEqual([{ runtimeStatus: 'stopped', updatedAt: NOW, lastMessageAt: NOW }])
    expect(res.closedAt).toBe('2026-06-16T15:00:00.000Z')
    expect(res.title).toBe('renamed')
    expect(res.runtimeStatus).toBe('stopped')
  })

  test('a terminal child also emits child_session.updated and resolves the parent tool item', async () => {
    const h = harness()
    const calls: (AgentItemStatus | undefined)[] = []
    const resolvers = new Map<string, LiveItemResolver>([
      [
        'tc-1',
        (patch) => {
          calls.push(patch.status)
          return true
        },
      ],
    ])
    await call({
      h,
      session: session({ parentSessionId: 'parent-1', sourceToolCallId: 'tc-1' }),
      status: 'stopped',
      resolvers,
    })
    expect(h.pubs.map((p) => p.type)).toEqual([
      'session.updated',
      'session.updated',
      'child_session.updated',
    ])
    expect(calls).toEqual(['aborted']) // stopped → aborted via TERMINAL_ITEM_STATUS
  })

  test('a still-running child publishes summaries but does NOT resolve the parent item', async () => {
    const h = harness()
    const calls: (AgentItemStatus | undefined)[] = []
    const resolvers = new Map<string, LiveItemResolver>([
      [
        'tc-1',
        (patch) => {
          calls.push(patch.status)
          return true
        },
      ],
    ])
    await call({
      h,
      session: session({ parentSessionId: 'parent-1', sourceToolCallId: 'tc-1' }),
      status: 'running',
      resolvers,
    })
    expect(calls).toHaveLength(0)
    expect(h.pubs.some((p) => p.type === 'child_session.updated')).toBe(true)
  })
})

describe('publishChildSummary', () => {
  test('publishes to both the child and its parent', async () => {
    const h = harness()
    publishChildSummary({
      streamRegistry: h.streamRegistry,
      parentSessionId: 'parent-1',
      child: session(),
    })
    expect(h.pubs).toEqual([
      { userId: 'u', sessionId: 'child-1', type: 'session.updated' },
      { userId: 'u', sessionId: 'parent-1', type: 'child_session.updated' },
    ])
  })
})
