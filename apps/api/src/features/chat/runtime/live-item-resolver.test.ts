/**
 * Tests for the generic live-item resolver mechanism that fixes the
 * write-ordering race between a still-running parent run and a completing
 * child session (e.g. delegate sub-agent).
 *
 * The race: the delegate tool returns immediately; handleToolExecutionEnd
 * marks the item `running` in state.currentPayload. When the child completes,
 * markRuntimeSessionStatus → resolveParentToolItem used to patch ONLY the DB
 * row, but the parent run's later persistAndPublish re-wrote state.currentPayload
 * (still `running`) over that patch. Result: stuck spinner / lingering status.
 *
 * The fix: resolveParentToolItem checks liveItemResolvers first. If a resolver
 * exists, it patches state.currentPayload IN PLACE (same approach emitBackground
 * uses for background jobs) and calls persistAndPublish — so the next parent
 * flush carries the terminal status instead of overwriting it.
 */
import { describe, expect, it, mock } from 'bun:test'
import type { AgentItemStatus } from '@localixai/agent/agents'
import { markRuntimeSessionStatus } from './session-status'
import { createRuntimeState, type LiveItemResolver } from './agent-runner-state'
import { testWork } from '../../../testing/work-fixture'
import { teardownRun } from './run/run-teardown'
import type { RunEnv } from './run/types'
import type { SessionRecord } from '../repository'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2026-06-16T00:00:00.000Z'

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'child-1',
    userId: 'u1',
    parentSessionId: 'parent-1',
    sourceToolCallId: 'tc-delegate-1',
    sessionKind: 'subagent',
    runtimeStatus: 'completed',
    provenance: {
      kind: 'task-delegation',
      parentSessionId: 'parent-1',
      toolCallId: 'tc-delegate-1',
    },
    title: 'Test child',
    rootSessionId: 'parent-1',
    createdAt: NOW,
    updatedAt: NOW,
    lastMessageAt: NOW,
    ...overrides,
  } as SessionRecord
}

function makeRepo() {
  const updatedMessages: Array<{ id: string; payload: unknown }> = []
  const updatedSessions: Array<{ id: string; status: string }> = []
  const messages: Array<{
    id: string
    payload: { role: string; items?: Array<Record<string, unknown>> }
  }> = [
    {
      id: 'msg-1',
      payload: {
        role: 'assistant',
        items: [
          {
            id: 'item-1',
            type: 'tool_call',
            toolCallId: 'tc-delegate-1',
            name: 'agents',
            status: 'running',
          },
          { id: 'item-2', type: 'text', text: 'hi' },
        ],
      },
    },
  ]
  return {
    updatedMessages,
    updatedSessions,
    repo: {
      findActiveBranchToolCallMessage: async () => messages[0],
      updateMessage: async (_u: string, _s: string, id: string, patch: Record<string, unknown>) => {
        // The real repo takes a PATCH, merges it into the stored row, and returns the merge.
        const prev = messages.find((m) => m.id === id)?.payload
        const merged = { ...prev, ...patch }
        updatedMessages.push({ id, payload: merged })
        return merged
      },
      updateSession: async (_u: string, id: string, s: SessionRecord) => {
        updatedSessions.push({ id, status: s.runtimeStatus })
      },
      // No stored row: the status write merges onto the record the caller holds.
      getSession: async () => undefined,
    } as unknown as Parameters<typeof markRuntimeSessionStatus>[0]['repo'],
  }
}

function makeStreamRegistry() {
  const published: Array<{ userId: string; sessionId: string; event: unknown }> = []
  return {
    published,
    registry: {
      publish: (userId: string, sessionId: string, event: unknown) => {
        published.push({ userId, sessionId, event })
      },
    } as unknown as Parameters<typeof markRuntimeSessionStatus>[0]['streamRegistry'],
  }
}

// ---------------------------------------------------------------------------
// Live-path tests
// ---------------------------------------------------------------------------

describe('resolveParentToolItem — live path (parent run still active)', () => {
  it('calls the live resolver with the terminal status when one is registered', async () => {
    const { repo } = makeRepo()
    const { registry } = makeStreamRegistry()
    const liveItemResolvers = new Map<string, LiveItemResolver>()
    const receivedStatuses: (AgentItemStatus | undefined)[] = []
    liveItemResolvers.set('tc-delegate-1', (p) => {
      receivedStatuses.push(p.status)
      return true
    })

    await markRuntimeSessionStatus({
      repo,
      streamRegistry: registry,
      now: () => NOW,
      userId: 'u1',
      session: makeSession({ runtimeStatus: 'completed' }),
      status: 'completed',
      liveItemResolvers,
    })

    expect(receivedStatuses).toEqual(['completed'])
  })

  it('maps child runtimeStatus correctly to AgentItemStatus', async () => {
    const cases: Array<[SessionRecord['runtimeStatus'], AgentItemStatus]> = [
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['stopped', 'aborted'],
    ]
    for (const [childStatus, expectedItemStatus] of cases) {
      const { repo } = makeRepo()
      const { registry } = makeStreamRegistry()
      const liveItemResolvers = new Map<string, LiveItemResolver>()
      const received: (AgentItemStatus | undefined)[] = []
      liveItemResolvers.set('tc-delegate-1', (p) => {
        received.push(p.status)
        return true
      })

      await markRuntimeSessionStatus({
        repo,
        streamRegistry: registry,
        now: () => NOW,
        userId: 'u1',
        session: makeSession({ runtimeStatus: childStatus }),
        status: childStatus,
        liveItemResolvers,
      })

      expect(received).toEqual([expectedItemStatus])
    }
  })

  it('does NOT do the DB point read when a live resolver is present', async () => {
    const { repo, updatedMessages } = makeRepo()
    const findMessageSpy = mock(repo.findActiveBranchToolCallMessage.bind(repo))
    ;(
      repo as {
        findActiveBranchToolCallMessage: typeof repo.findActiveBranchToolCallMessage
      }
    ).findActiveBranchToolCallMessage = findMessageSpy
    const { registry } = makeStreamRegistry()
    const liveItemResolvers = new Map<string, LiveItemResolver>()
    liveItemResolvers.set('tc-delegate-1', () => true)

    await markRuntimeSessionStatus({
      repo,
      streamRegistry: registry,
      now: () => NOW,
      userId: 'u1',
      session: makeSession({ runtimeStatus: 'completed' }),
      status: 'completed',
      liveItemResolvers,
    })

    // The DB message row must not be consulted when a live resolver exists.
    expect(findMessageSpy).not.toHaveBeenCalled()
    expect(updatedMessages).toHaveLength(0)
  })

  it('falls back to the stored row when the live run no longer holds the item', async () => {
    // A resolver that declines is a run whose row was split off at a steering point: the item
    // now lives only in the sealed part-1 row, which the run will never write again.
    const { repo, updatedMessages } = makeRepo()
    const { registry } = makeStreamRegistry()
    const liveItemResolvers = new Map<string, LiveItemResolver>()
    liveItemResolvers.set('tc-delegate-1', () => false)

    await markRuntimeSessionStatus({
      repo,
      streamRegistry: registry,
      now: () => NOW,
      userId: 'u1',
      session: makeSession({ runtimeStatus: 'completed' }),
      status: 'completed',
      liveItemResolvers,
    })

    expect(updatedMessages).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Fallback-path tests (parent run already ended)
// ---------------------------------------------------------------------------

describe('resolveParentToolItem — fallback path (parent run ended)', () => {
  it('point-reads and patches the running item when no live resolver exists', async () => {
    const { repo, updatedMessages } = makeRepo()
    const { registry, published } = makeStreamRegistry()
    const liveItemResolvers = new Map<string, LiveItemResolver>()
    // No resolver registered — parent run is gone.

    await markRuntimeSessionStatus({
      repo,
      streamRegistry: registry,
      now: () => NOW,
      userId: 'u1',
      session: makeSession({ runtimeStatus: 'completed' }),
      status: 'completed',
      liveItemResolvers,
    })

    // DB was patched.
    expect(updatedMessages).toHaveLength(1)
    const patched = updatedMessages[0]!.payload as { items: Array<Record<string, unknown>> }
    const delegateItem = patched.items.find((i) => i['toolCallId'] === 'tc-delegate-1')
    expect(delegateItem?.['status']).toBe('completed')
    // message.updated was published.
    const msgUpdated = published.find(
      (p) =>
        typeof p.event === 'object' &&
        (p.event as { type: string } | null)?.type === 'message.updated',
    )
    expect(msgUpdated).toBeDefined()
  })

  it('is a no-op when the child has no parentSessionId or sourceToolCallId', async () => {
    const { repo, updatedMessages } = makeRepo()
    const { registry } = makeStreamRegistry()
    const liveItemResolvers = new Map<string, LiveItemResolver>()

    await markRuntimeSessionStatus({
      repo,
      streamRegistry: registry,
      now: () => NOW,
      userId: 'u1',
      session: makeSession({
        parentSessionId: undefined,
        sourceToolCallId: undefined,
        runtimeStatus: 'completed',
      }),
      status: 'completed',
      liveItemResolvers,
    })

    expect(updatedMessages).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Resolver lifecycle
// ---------------------------------------------------------------------------

/**
 * This block used to hold TWO tests that built a bare `Map`, hand-ran the production logic
 * inside the test body ("Simulate execute-run's finally: remove keys in runLiveResolverKeys"),
 * and then asserted that the hand-written code they had just run did what they had written.
 * They imported neither `teardownRun` nor anything else that ships. Deleting the whole
 * deregistration loop from `run/run-teardown.ts` left both of them green — along with all 853
 * chat tests. Verified by mutation. A test that reimplements its subject certifies the test.
 *
 * One honest test replaces both: drive the REAL teardown, then prove the consequence it exists
 * for — a child that terminates AFTER its parent run ended must take the DB-walk fallback,
 * because a leaked resolver would patch a dead run's `currentPayload` (the exact write-ordering
 * race this file's header describes) and the parent's item would never leave `running`.
 *
 * (The resolver's own one-shot self-deregistration lives in the closure `event-handlers-tools.ts`
 * registers; its live-path consumption is covered above and in session-status.test.ts.)
 */
describe('liveItemResolvers lifecycle — through the real run teardown', () => {
  it('teardownRun deregisters this run’s unfired resolvers, so a late child falls back to DB', async () => {
    const runtimeState = createRuntimeState(testWork())
    const runLiveResolverKeys = new Set<string>(['tc-delegate-1'])
    let resolverCalls = 0
    runtimeState.liveItemResolvers.set('tc-delegate-1', () => {
      resolverCalls += 1
      return true
    })

    teardownRun({
      env: {
        deps: {},
        hasPendingQueue: () => false,
        drainPendingAndRun: async () => {},
      } as unknown as RunEnv,
      runtimeState,
      // A plain parent chat session: it has no pending queue, so teardown's
      // only observable effect here is the deregistration under test.
      session: makeSession({
        id: 'parent-1',
        sessionKind: 'chat',
        parentSessionId: undefined,
        sourceToolCallId: undefined,
        provenance: { kind: 'root' },
      }),
      abort: new AbortController(),
      miniAppHooksForRun: [],
      runLiveResolverKeys,
      unsubLsp: undefined,
      defaultCwd: undefined,
    })

    expect(runtimeState.liveItemResolvers.has('tc-delegate-1')).toBe(false)
    expect(runLiveResolverKeys.size).toBe(0)

    // The child terminates late. With the resolver gone the DB fallback must do the work.
    const { repo, updatedMessages } = makeRepo()
    const { registry } = makeStreamRegistry()
    await markRuntimeSessionStatus({
      repo,
      streamRegistry: registry,
      now: () => NOW,
      userId: 'u1',
      session: makeSession({ runtimeStatus: 'completed' }),
      status: 'completed',
      liveItemResolvers: runtimeState.liveItemResolvers,
    })

    expect(
      resolverCalls,
      'a resolver survived teardown — it would patch a dead run’s payload',
    ).toBe(0)
    expect(
      updatedMessages.length,
      'neither path ran: the parent item is stuck on `running`',
    ).toBeGreaterThan(0)
  })
})
