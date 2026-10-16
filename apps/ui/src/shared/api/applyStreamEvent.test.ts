import { describe, expect, test } from 'bun:test'

import {
  applyStreamEventToSession,
  needsSessionResync,
  removeHitlInteractionsFromSource,
} from './applyStreamEvent'
import type { AgentStreamEvent, UiSession } from './contracts'

// Minimal session covering only the fields the non-message cases read/preserve.
// Cast through unknown — building a full UiSession isn't needed for these invariants.
function makeSession(over: Partial<UiSession> = {}): UiSession {
  return {
    id: 'sess-1',
    messages: [],
    isRunning: false,
    pendingInteraction: null,
    // Always present in production (both converters seed it); the reducer still
    // tolerates its absence for a session rehydrated from an older shape.
    pendingInteractionQueue: [],
    title: 'Original',
    updatedAt: 1,
    ...over,
  } as unknown as UiSession
}

// Build event literals loosely — the reducer only branches on `type` + ids, so the
// exact discriminated-union shape isn't what these invariants exercise.
const ev = (e: { type: string } & Record<string, unknown>) => e as unknown as AgentStreamEvent

describe('applyStreamEventToSession — foreign-session guard', () => {
  // The #1 documented bug source: every case must no-op (return the SAME ref)
  // when the event targets a different session.
  const foreign: AgentStreamEvent[] = [
    ev({ type: 'message.removed', sessionId: 'other', messageId: 'm1' }),
    ev({ type: 'lsp.status', sessionId: 'other', servers: [] }),
    ev({ type: 'run.started', sessionId: 'other', messageId: 'm-run' }),
    ev({ type: 'run.completed', sessionId: 'other' }),
    ev({ type: 'run.failed', sessionId: 'other' }),
    ev({ type: 'session_timing.updated', sessionId: 'other', timing: {} }),
    ev({
      type: 'agent.phase',
      sessionId: 'other',
      phase: 'connecting',
      label: 'Connecting',
      active: true,
    }),
    ev({
      type: 'hitl.requested',
      sessionId: 'other',
      request: { kind: 'ask', requestId: 'r', title: 't', payload: {} },
    }),
    ev({ type: 'hitl.resolved', sessionId: 'other', requestId: 'r' }),
    ev({ type: 'plan.updated', sessionId: 'other', plans: [] }),
  ]

  test('returns the identical session reference for every foreign event', () => {
    const session = makeSession()
    for (const event of foreign) {
      expect(applyStreamEventToSession(session, event)).toBe(session)
    }
  })
})

describe('applyStreamEventToSession — hitl.resolved clears the overlay', () => {
  const pending = { kind: 'ask', request: { id: 'req-1', kind: 'ask', title: 't', payload: {} } }

  test('drops pendingInteraction when the resolved requestId matches', () => {
    const session = makeSession({ pendingInteraction: pending } as never)
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'hitl.resolved', sessionId: 'sess-1', requestId: 'req-1' }),
    )
    expect(next.pendingInteraction).toBeNull()
    expect(next).not.toBe(session)
  })

  test('no-ops for a stale clear targeting an already-replaced prompt', () => {
    const session = makeSession({ pendingInteraction: pending } as never)
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'hitl.resolved', sessionId: 'sess-1', requestId: 'OLD' }),
    )
    expect(next).toBe(session)
  })
})

describe('applyStreamEventToSession — authoritative session usage', () => {
  test('replaces the local total with the server snapshot', () => {
    const next = applyStreamEventToSession(
      makeSession({ sessionUsage: { totalTokens: 10 } }),
      ev({
        type: 'session_usage.updated',
        sessionId: 'sess-1',
        usage: { totalTokens: 55, cacheWrite1hTokens: 7, isSummary: true },
      }),
    )
    expect(next.sessionUsage).toEqual({
      totalTokens: 55,
      cacheWrite1hTokens: 7,
      isSummary: true,
    })
  })
})

describe('applyStreamEventToSession — run lifecycle', () => {
  test('run.started flips isRunning true and preserves other fields', () => {
    const session = makeSession({ title: 'Keep me', isRunning: false })
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'run.started', sessionId: 'sess-1', messageId: 'm-run' }),
    )
    expect(next.isRunning).toBe(true)
    expect(next.title).toBe('Keep me') // spread preservation
    expect(next).not.toBe(session)
  })

  test('run.started clears a stale activePhase from a prior run', () => {
    const session = makeSession({
      activePhase: { id: 'generating-title', label: 'Generating title' },
    } as never)
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'run.started', sessionId: 'sess-1', messageId: 'm-run' }),
    )
    expect(next.activePhase).toBeNull()
    expect(next.isRunning).toBe(true)
  })

  test('run.completed clears a pending HITL interaction (guards the 409 resurrection bug)', () => {
    const session = makeSession({
      isRunning: true,
      pendingInteraction: {
        kind: 'confirm',
        request: { id: 'r', kind: 'confirm', title: 't', payload: {} },
      } as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'run.completed', sessionId: 'sess-1' }),
    )
    expect(next.isRunning).toBe(false)
    expect(next.pendingInteraction).toBeNull()
  })

  test('run.failed behaves identically to run.completed', () => {
    const session = makeSession({ isRunning: true, pendingInteraction: { kind: 'ask' } as never })
    const next = applyStreamEventToSession(session, ev({ type: 'run.failed', sessionId: 'sess-1' }))
    expect(next.isRunning).toBe(false)
    expect(next.pendingInteraction).toBeNull()
  })
})

describe('applyStreamEventToSession — field updates preserve the rest', () => {
  test('lsp.status sets servers only', () => {
    const session = makeSession({ title: 'T' })
    const servers = [{ id: 'ts', status: 'ready' }] as never
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'lsp.status', sessionId: 'sess-1', servers }),
    )
    expect(next.lspServers).toBe(servers)
    expect(next.title).toBe('T')
  })

  test('plan.updated replaces the plan versions only', () => {
    const session = makeSession({ title: 'T' })
    const plans = [{ id: 'p2', version: 2 }] as never
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'plan.updated', sessionId: 'sess-1', plans }),
    )
    expect(next.plans).toBe(plans)
    expect(next.title).toBe('T')
  })

  test('message.removed drops only the matching message', () => {
    const session = makeSession({ messages: [{ id: 'a' }, { id: 'b' }] as never })
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'message.removed', sessionId: 'sess-1', messageId: 'a' }),
    )
    expect(next.messages.map((m) => m.id)).toEqual(['b'])
  })

  test('message.removed reconciles an all-history usage total from a loaded tail', () => {
    const removedUsage = {
      totalTokens: 110,
      inputTokens: 100,
      outputTokens: 10,
      cachedInputTokens: 80,
      cacheWriteTokens: 5,
      cacheWrite1hTokens: 3,
      reasoningTokens: 4,
      totalCost: 0.02,
      costSource: 'actual' as const,
    }
    const session = makeSession({
      // Simulate a 1,002-row session whose client currently renders only the tail.
      // The server summary includes all 501 assistant turns, not just this row.
      messageCount: 1_002,
      messages: [
        { id: 'tail-user', role: 'user', content: 'latest' },
        { id: 'tail-assistant', role: 'assistant', usage: removedUsage },
      ] as UiSession['messages'],
      sessionUsage: {
        totalTokens: 55_110,
        inputTokens: 50_100,
        outputTokens: 5_010,
        cachedInputTokens: 40_080,
        cacheWriteTokens: 2_505,
        cacheWrite1hTokens: 1_503,
        reasoningTokens: 2_004,
        totalCost: 10.02,
        costSource: 'actual',
        isSummary: true,
      },
    })
    const event = ev({
      type: 'message.removed',
      sessionId: 'sess-1',
      messageId: 'tail-assistant',
    })

    const once = applyStreamEventToSession(session, event)
    expect(once.messages.map((message) => message.id)).toEqual(['tail-user'])
    expect(once.messageCount).toBe(1_001)
    expect(once.sessionUsage).toMatchObject({
      totalTokens: 55_000,
      inputTokens: 50_000,
      outputTokens: 5_000,
      cachedInputTokens: 40_000,
      cacheWriteTokens: 2_500,
      cacheWrite1hTokens: 1_500,
      reasoningTokens: 2_000,
      totalCost: 10,
      costSource: 'actual',
      isSummary: true,
    })

    // Replay/reconnect may deliver the same removal again. It must not subtract
    // the turn twice or decrement the authoritative persisted count twice.
    expect(applyStreamEventToSession(once, event)).toBe(once)
  })
})

describe('applyStreamEventToSession — agent.phase', () => {
  test('active:true sets the current phase', () => {
    const session = makeSession()
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'agent.phase',
        sessionId: 'sess-1',
        phase: 'connecting',
        label: 'Connecting',
        active: true,
      }),
    )
    expect(next.activePhase).toEqual({ id: 'connecting', label: 'Connecting' })
  })

  test("a run-lifecycle code arrives without copy and gets the client's", () => {
    // The host emits WHAT it is doing; how that reads is this client's decision.
    const session = makeSession()
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'agent.phase', sessionId: 'sess-1', phase: 'generating-title', active: true }),
    )
    expect(next.activePhase).toEqual({ id: 'generating-title', label: 'Generating title' })
    // An unknown code is shown as itself rather than blank — visible before the map learns it.
    const unknown = applyStreamEventToSession(
      session,
      ev({ type: 'agent.phase', sessionId: 'sess-1', phase: 'defragmenting', active: true }),
    )
    expect(unknown.activePhase?.label).toBe('defragmenting')
  })

  test('active:false clears the phase when the id matches', () => {
    const session = makeSession({
      activePhase: { id: 'generating-title', label: 'Generating title' },
    } as never)
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'agent.phase',
        sessionId: 'sess-1',
        phase: 'generating-title',
        label: 'Generating title',
        active: false,
      }),
    )
    expect(next.activePhase).toBeNull()
  })

  test('a stale leave (mismatched id) is a no-op and keeps the newer phase', () => {
    const session = makeSession({ activePhase: { id: 'thinking', label: 'Thinking' } } as never)
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'agent.phase',
        sessionId: 'sess-1',
        phase: 'generating-title',
        label: 'Generating title',
        active: false,
      }),
    )
    expect(next).toBe(session) // same ref — no churn
    expect(next.activePhase).toEqual({ id: 'thinking', label: 'Thinking' })
  })
})

describe('applyStreamEventToSession — message.delta (incremental append)', () => {
  const withMsg = () =>
    makeSession({
      messages: [
        {
          id: 'm1',
          items: [
            { id: 'reasoning-0', type: 'reasoning', text: 'think', status: 'completed' },
            { id: 'text-0', type: 'text', text: 'Hello', status: 'completed' },
            { id: 'tool-x', type: 'tool_call', status: 'completed' },
          ],
        },
      ] as never,
    })

  test('appends textAppend to the matching text item', () => {
    const session = withMsg()
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm1',
        textItemId: 'text-0',
        textAppend: ' world',
      }),
    )
    const items = next.messages[0].items as Array<{ id: string; text?: string }>
    expect(items.find((i) => i.id === 'text-0')?.text).toBe('Hello world')
  })

  test('reference-stabilizes untouched items; only the grown item is a new object', () => {
    const session = withMsg()
    const prev = session.messages[0].items as unknown[]
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm1',
        textItemId: 'text-0',
        textAppend: '!',
      }),
    )
    const items = next.messages[0].items as unknown[]
    expect(items[0]).toBe(prev[0]) // reasoning-0 untouched
    expect(items[2]).toBe(prev[2]) // tool-x untouched
    expect(items[1]).not.toBe(prev[1]) // text-0 replaced
  })

  test('applies a burst of item appends without replacing untouched items', () => {
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      id: `tool-${index}`,
      type: 'command',
      status: 'running',
      name: 'bash',
      output: '',
    }))
    const session = makeSession({
      messages: [{ id: 'm1', role: 'assistant', items }] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm1',
        itemAppends: Array.from({ length: 1_000 }, (_, index) => ({
          itemId: `tool-${index * 2}`,
          slot: 'output',
          append: String(index),
        })),
      }),
    )
    const nextItems = next.messages[0].items as Array<{ output?: string }>

    expect(nextItems[0]?.output).toBe('0')
    expect(nextItems[998]?.output).toBe('499')
    expect(nextItems[999]).toBe(items[999])
  })

  test('appends reasoningAppend to the matching reasoning item', () => {
    const session = withMsg()
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm1',
        reasoningItemId: 'reasoning-0',
        reasoningAppend: 'ing…',
      }),
    )
    const items = next.messages[0].items as Array<{ id: string; text?: string }>
    expect(items.find((i) => i.id === 'reasoning-0')?.text).toBe('thinking…')
  })

  test('unknown messageId is a no-op (delta before baseline) — same ref', () => {
    const session = withMsg()
    expect(
      applyStreamEventToSession(
        session,
        ev({
          type: 'message.delta',
          sessionId: 'sess-1',
          messageId: 'nope',
          textItemId: 'text-0',
          textAppend: 'x',
        }),
      ),
    ).toBe(session)
  })

  test('foreign session is a no-op — same ref', () => {
    const session = withMsg()
    expect(
      applyStreamEventToSession(
        session,
        ev({
          type: 'message.delta',
          sessionId: 'other',
          messageId: 'm1',
          textItemId: 'text-0',
          textAppend: 'x',
        }),
      ),
    ).toBe(session)
  })

  test('no matching item id is a no-op — same ref', () => {
    const session = withMsg()
    expect(
      applyStreamEventToSession(
        session,
        ev({
          type: 'message.delta',
          sessionId: 'sess-1',
          messageId: 'm1',
          textItemId: 'text-99',
          textAppend: 'x',
        }),
      ),
    ).toBe(session)
  })

  test('updates the tail of a 100k-message transcript without disturbing history', () => {
    const messages = Array.from({ length: 100_000 }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 99_999 ? 'live' : `message ${index}`,
    }))
    const session = makeSession({ messages: messages as never })

    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm-99999',
        contentAppend: ' tail',
      }),
    )

    expect(next.messages).toHaveLength(100_000)
    expect(next.messages[99_998]).toBe(session.messages[99_998])
    expect(next.messages[99_999]?.content).toBe('live tail')
  })

  test('keeps repeated tail deltas off the canonical array and materializes on settlement', () => {
    const session = withMsg()
    const canonicalMessages = session.messages
    const canonicalTail = canonicalMessages[0]
    const once = applyStreamEventToSession(
      session,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm1',
        textItemId: 'text-0',
        textAppend: ' one',
      }),
    )
    const twice = applyStreamEventToSession(
      once,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm1',
        textItemId: 'text-0',
        textAppend: ' two',
      }),
    )

    expect(session.messages).toBe(canonicalMessages)
    expect(session.messages[0]).toBe(canonicalTail)
    expect((session.messages[0].items?.[1] as { text?: string } | undefined)?.text).toBe('Hello')
    expect(twice.messages).not.toBe(once.messages)
    expect(twice.messages[0]).not.toBe(once.messages[0])
    expect((twice.messages[0].items?.[1] as { text?: string } | undefined)?.text).toBe(
      'Hello one two',
    )

    const snapshot = applyStreamEventToSession(
      twice,
      ev({
        type: 'message.updated',
        sessionId: 'sess-1',
        message: {
          id: 'm1',
          payload: {
            role: 'assistant',
            items: [{ id: 'text-0', type: 'text', text: 'snapshot', status: 'completed' }],
          },
        },
      }),
    )
    expect(snapshot.messages).not.toBe(twice.messages)
    expect((snapshot.messages[0].items?.[0] as { text?: string } | undefined)?.text).toBe(
      'snapshot',
    )

    const settled = applyStreamEventToSession(
      twice,
      ev({ type: 'run.completed', sessionId: 'sess-1' }),
    )
    expect(settled.messages).not.toBe(twice.messages)
    expect(settled.messages[0]).toBe(twice.messages[0])
  })

  test('tail delta cost stays independent of transcript length across repeated events', () => {
    const makeTranscript = (length: number) =>
      makeSession({
        messages: Array.from({ length }, (_, index) => ({
          id: `m-${index}`,
          role: 'assistant',
          content: '',
        })) as never,
      })
    const eventCount = 160
    const event = ev({
      type: 'message.delta',
      sessionId: 'sess-1',
      messageId: 'm-live',
      contentAppend: 'x',
    })
    const run = (base: UiSession) => {
      let session = base
      const startedAt = performance.now()
      for (let index = 0; index < eventCount; index += 1) {
        session = applyStreamEventToSession(session, event)
      }
      expect(session.messages.at(-1)?.content).toHaveLength(eventCount)
      return performance.now() - startedAt
    }
    const short = makeTranscript(10)
    short.messages[short.messages.length - 1]!.id = 'm-live'
    const long = makeTranscript(100_000)
    long.messages[long.messages.length - 1]!.id = 'm-live'

    // Warm both paths before alternating arms; medians keep scheduler noise from
    // turning this complexity guard into a single-sample wall-clock assertion.
    run(short)
    run(long)
    const shortSamples: number[] = []
    const longSamples: number[] = []
    for (let sample = 0; sample < 5; sample += 1) {
      if (sample % 2 === 0) {
        longSamples.push(run(long))
        shortSamples.push(run(short))
      } else {
        shortSamples.push(run(short))
        longSamples.push(run(long))
      }
    }
    shortSamples.sort((a, b) => a - b)
    longSamples.sort((a, b) => a - b)
    const shortMedian = shortSamples[2]!
    const longMedian = longSamples[2]!

    // A fixed allowance absorbs timer granularity; the old K*N transcript copy
    // takes several milliseconds for this arm and exceeds it by a wide margin.
    expect(longMedian).toBeLessThan(shortMedian * 8 + 2)
  })
})

describe('applyStreamEventToSession — session_triggers.updated', () => {
  const loopA = {
    id: 'loop-1',
    kind: 'fixed' as const,
    cron: '*/5 * * * *',
    prompt: 'check deploy',
    maintenance: false,
    nextRunAt: '2026-06-16T10:05:00.000Z',
    createdAt: '2026-06-16T10:00:00.000Z',
    target: 'session' as const,
    lastRunAt: null,
    lastStatus: null,
    runCount: 0,
  }
  const loopB = {
    id: 'loop-2',
    kind: 'dynamic' as const,
    cron: null,
    prompt: 'sync stats',
    maintenance: false,
    delaySeconds: 300,
    nextRunAt: '2026-06-16T10:06:00.000Z',
    createdAt: '2026-06-16T10:01:00.000Z',
    target: 'session' as const,
    lastRunAt: null,
    lastStatus: null,
    runCount: 0,
  }

  test('replaces loops and preserves the rest', () => {
    const session = makeSession({ title: 'Keep me', loops: [loopA] } as never)
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'session_triggers.updated', sessionId: 'sess-1', loops: [loopA, loopB] }),
    )
    expect(next.loops).toEqual([loopA, loopB])
    expect(next.title).toBe('Keep me') // spread preservation
    expect(next).not.toBe(session)
  })

  test('handles empty loops array (all cancelled)', () => {
    const session = makeSession({ loops: [loopA] } as never)
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'session_triggers.updated', sessionId: 'sess-1', loops: [] }),
    )
    expect(next.loops).toEqual([])
  })

  test('is a no-op for a foreign session', () => {
    const session = makeSession({ loops: [loopA] } as never)
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'session_triggers.updated', sessionId: 'other-sess', loops: [loopB] }),
    )
    expect(next).toBe(session)
  })
})

describe('applyStreamEventToSession — unknown event', () => {
  test('returns the identical session reference', () => {
    const session = makeSession()
    expect(applyStreamEventToSession(session, ev({ type: 'totally.unknown' }))).toBe(session)
  })
})

describe('applyStreamEventToSession — message + session mutations', () => {
  // PersistedMessage shape (toUiMessage reads message.payload.*).
  const msg = (id: string, content = 'x') => ({
    id,
    sessionId: 'sess-1',
    userId: 'u',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    payload: { id, role: 'assistant', content },
  })
  const withMsgs = (ids: string[]) =>
    makeSession({ messages: ids.map((id) => ({ id })) as unknown as UiSession['messages'] })

  test('message.created appends a new message', () => {
    const r = applyStreamEventToSession(
      makeSession({ messages: [] }),
      ev({ type: 'message.created', sessionId: 'sess-1', message: msg('m1') }),
    )
    expect(r.messages.map((m) => m.id)).toEqual(['m1'])
  })

  test('message.created replaces in place when the id already exists (no duplicate)', () => {
    const r = applyStreamEventToSession(
      withMsgs(['m1']),
      ev({ type: 'message.created', sessionId: 'sess-1', message: msg('m1') }),
    )
    expect(r.messages).toHaveLength(1)
  })

  test('message.updated replaces the existing message by id (does not append)', () => {
    const r = applyStreamEventToSession(
      withMsgs(['m1']),
      ev({ type: 'message.updated', sessionId: 'sess-1', message: msg('m1', 'new') }),
    )
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0].id).toBe('m1')
  })

  test('message.updated replaces a deferred settled item instead of stabilizing its skeleton', () => {
    const deferred = {
      id: 'tool-a',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'call-a',
      name: 'read',
      activeVerb: 'Reading',
    }
    const session = makeSession({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          items: [deferred],
          deferredToolItemIds: ['tool-a'],
        },
      ] as UiSession['messages'],
    })
    const baseWire = msg('m1')
    const wire = {
      ...baseWire,
      payload: {
        ...baseWire.payload,
        items: [{ ...deferred, resultText: 'full result', output: { output: 'full output' } }],
      },
    }

    const next = applyStreamEventToSession(
      session,
      ev({ type: 'message.updated', sessionId: 'sess-1', message: wire }),
    )

    expect(next.messages[0]?.items?.[0]).not.toBe(deferred)
    expect(next.messages[0]?.items?.[0]).toMatchObject({ resultText: 'full result' })
    expect(next.messages[0]?.deferredToolItemIds).toBeUndefined()
  })

  test('authoritative snapshots correct completed tool output without changing its status', () => {
    const item = {
      id: 'tool-a',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'call-a',
      name: 'read',
      activeVerb: 'Reading',
      resultText: 'old output',
    } as const
    const session = makeSession({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          items: [item],
        },
      ] as UiSession['messages'],
    })
    const base = msg('m1')
    const update = (resultText: string) =>
      ev({
        type: 'message.updated',
        sessionId: 'sess-1',
        message: { ...base, payload: { ...base.payload, items: [{ ...item, resultText }] } },
      })
    const unchanged = applyStreamEventToSession(session, update('old output'))
    expect(unchanged.messages[0]?.items?.[0]).toBe(item)
    const corrected = applyStreamEventToSession(session, update('corrected output'))
    expect(corrected.messages[0]?.items?.[0]).not.toBe(item)
    expect(corrected.messages[0]?.items?.[0]).toMatchObject({ resultText: 'corrected output' })
    expect(item.resultText).toBe('old output')
  })

  test('message.updated replaces its contribution inside server all-history usage', () => {
    const previous = {
      id: 'm1',
      role: 'assistant',
      content: 'old',
      usage: { totalTokens: 10, inputTokens: 7, outputTokens: 3 },
    }
    const baseWire = msg('m1', 'new')
    const nextWire = {
      ...baseWire,
      payload: {
        ...baseWire.payload,
        usage: { totalTokens: 14, inputTokens: 9, outputTokens: 5 },
      },
    }
    const r = applyStreamEventToSession(
      makeSession({
        messages: [previous] as UiSession['messages'],
        sessionUsage: { totalTokens: 110, inputTokens: 77, outputTokens: 33, isSummary: true },
      }),
      ev({ type: 'message.updated', sessionId: 'sess-1', message: nextWire }),
    )
    expect(r.sessionUsage).toMatchObject({ totalTokens: 114, inputTokens: 79, outputTokens: 35 })
  })

  test('unknown historical update does not double-count a windowed all-history summary', () => {
    const session = makeSession({
      messages: [{ id: 'tail', role: 'user', content: 'tail' }] as UiSession['messages'],
      messageCount: 100_000,
      sessionUsage: { totalTokens: 900_000, inputTokens: 800_000, outputTokens: 100_000 },
    })
    const baseWire = msg('unloaded-assistant', 'historical update')
    const wire = {
      ...baseWire,
      payload: {
        ...baseWire.payload,
        usage: { totalTokens: 25, inputTokens: 20, outputTokens: 5 },
      },
    }
    const event = ev({ type: 'message.updated', sessionId: 'sess-1', message: wire })

    expect(needsSessionResync(session, event)).toBe(true)
    expect(applyStreamEventToSession(session, event)).toBe(session)
    expect(session.sessionUsage?.totalTokens).toBe(900_000)
  })

  test('unknown delta/removal request resync while known rows do not', () => {
    const session = makeSession({ messages: [{ id: 'tail' }] as UiSession['messages'] })
    expect(
      needsSessionResync(
        session,
        ev({ type: 'message.delta', sessionId: 'sess-1', messageId: 'old' }),
      ),
    ).toBe(true)
    expect(
      needsSessionResync(
        session,
        ev({ type: 'message.removed', sessionId: 'sess-1', messageId: 'old' }),
      ),
    ).toBe(true)
    expect(
      needsSessionResync(
        session,
        ev({ type: 'message.removed', sessionId: 'sess-1', messageId: 'tail' }),
      ),
    ).toBe(false)
  })

  test('session.updated patches title + isPinned', () => {
    const r = applyStreamEventToSession(
      makeSession({ title: 'Old' }),
      ev({ type: 'session.updated', session: { id: 'sess-1', title: 'New', isPinned: true } }),
    )
    expect(r.title).toBe('New')
    expect((r as unknown as { isPinned: boolean }).isPinned).toBe(true)
  })

  // ORDERING defense: session.updated is promote-only for isRunning. Title generation
  // on the first message publishes a session.updated that can arrive BEFORE run.started,
  // carrying runtimeStatus !== 'running'. It must NOT clear an isRunning already set
  // (optimistically on send, or by an earlier run.started) — the falling edge is owned
  // solely by run.completed/run.failed. Without this guard the "Working…" state would
  // flicker off then on again around the first turn.
  test('session.updated with a non-running status PRESERVES an existing isRunning=true', () => {
    const r = applyStreamEventToSession(
      makeSession({ isRunning: true }),
      ev({
        type: 'session.updated',
        session: { id: 'sess-1', title: 'Auto title', runtimeStatus: 'idle' },
      }),
    )
    expect(r.isRunning).toBe(true)
  })

  test('session.updated with runtimeStatus running PROMOTES isRunning to true', () => {
    const r = applyStreamEventToSession(
      makeSession({ isRunning: false }),
      ev({
        type: 'session.updated',
        session: { id: 'sess-1', title: 't', runtimeStatus: 'running' },
      }),
    )
    expect(r.isRunning).toBe(true)
  })

  test('session_queue.updated sets the queued messages', () => {
    const queue = [{ id: 'q1', text: 'later' }]
    const r = applyStreamEventToSession(
      makeSession(),
      ev({ type: 'session_queue.updated', sessionId: 'sess-1', queue }),
    )
    expect((r as unknown as { queuedMessages: unknown }).queuedMessages).toBe(queue)
  })

  test('queue removal preserves the optimistic user row until its outcome is known', () => {
    const queuedMessages = [
      {
        id: 'q1',
        kind: 'user' as const,
        priority: 0,
        preview: 'returned draft',
        queuedAt: '2026-07-20T00:00:00.000Z',
      },
      {
        id: 'q2',
        kind: 'user' as const,
        priority: 0,
        preview: 'still queued',
        queuedAt: '2026-07-20T00:00:01.000Z',
      },
    ]
    const session = makeSession({
      queuedMessages,
      messages: [
        {
          id: 'optimistic-returned',
          role: 'user',
          content: 'returned draft',
          optimistic: true,
        },
        {
          id: 'optimistic-still-queued',
          role: 'user',
          content: 'still queued',
          optimistic: true,
        },
      ] as never,
    })

    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'session_queue.updated',
        sessionId: 'sess-1',
        queue: [queuedMessages[1]],
      }),
    )

    expect(next.messages.map((message) => message.id)).toEqual([
      'optimistic-returned',
      'optimistic-still-queued',
    ])
  })

  test('queue removal does not erase a correlated optimistic row before its echo', () => {
    const queuedMessages = [
      {
        id: 'q1',
        clientMessageId: 'optimistic-first',
        kind: 'user' as const,
        priority: 0,
        preview: 'same preview',
        queuedAt: '2026-07-20T00:00:00.000Z',
      },
      {
        id: 'q2',
        clientMessageId: 'optimistic-second',
        kind: 'user' as const,
        priority: 0,
        preview: 'same preview',
        queuedAt: '2026-07-20T00:00:01.000Z',
      },
    ]
    const session = makeSession({
      queuedMessages,
      messages: [
        {
          id: 'optimistic-first',
          role: 'user',
          content: 'same preview, first full message',
          optimistic: true,
        },
        {
          id: 'optimistic-second',
          role: 'user',
          content: 'same preview, second full message',
          optimistic: true,
        },
      ] as never,
    })

    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'session_queue.updated',
        sessionId: 'sess-1',
        queue: [queuedMessages[1]],
      }),
    )

    expect(next.messages.map((message) => message.id)).toEqual([
      'optimistic-first',
      'optimistic-second',
    ])
  })

  test('a correlated row from another tab cannot consume a same-preview local placeholder', () => {
    const optimistic = {
      id: 'optimistic-local',
      role: 'user' as const,
      content: 'same preview',
      optimistic: true,
    }
    const session = makeSession({
      queuedMessages: [
        {
          id: 'q1',
          clientMessageId: 'optimistic-other-tab',
          kind: 'user',
          priority: 0,
          preview: 'same preview',
          queuedAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      messages: [optimistic] as never,
    })

    const next = applyStreamEventToSession(
      session,
      ev({ type: 'session_queue.updated', sessionId: 'sess-1', queue: [] }),
    )

    expect(next.messages).toEqual([optimistic])
  })

  test('queue drain never removes an unclaimed optimistic turn', () => {
    const session = makeSession({
      queuedMessages: [
        {
          id: 'q1',
          kind: 'user',
          priority: 0,
          preview: 'first',
          queuedAt: '2026-07-20T00:00:00.000Z',
        },
        {
          id: 'q2',
          kind: 'user',
          priority: 0,
          preview: 'second',
          queuedAt: '2026-07-20T00:00:01.000Z',
        },
      ],
      messages: [
        { id: 'server-user', role: 'user', content: 'first\n\n---\n\nsecond' },
        { id: 'optimistic-second', role: 'user', content: 'second', optimistic: true },
      ] as never,
    })

    const next = applyStreamEventToSession(
      session,
      ev({ type: 'session_queue.updated', sessionId: 'sess-1', queue: [] }),
    )

    expect(next.messages.map((message) => message.id)).toEqual(['server-user', 'optimistic-second'])
  })

  test('removing an internal wake never consumes a same-text user placeholder', () => {
    const optimistic = {
      id: 'optimistic-user',
      role: 'user' as const,
      content: 'same text',
      optimistic: true,
    }
    const session = makeSession({
      queuedMessages: [
        {
          id: 'wake-1',
          kind: 'wake',
          priority: 10,
          preview: 'same text',
          queuedAt: '2026-07-20T00:00:00.000Z',
          source: 'loop',
        },
      ],
      messages: [optimistic] as never,
    })

    const next = applyStreamEventToSession(
      session,
      ev({ type: 'session_queue.updated', sessionId: 'sess-1', queue: [] }),
    )

    expect(next.messages).toEqual([optimistic])
  })
})

describe('applyStreamEventToSession — idempotency under a re-applied frame', () => {
  // The realtime transport hands each frame to the reducer AT MOST ONCE: the
  // client tracks the monotonic namespaced cursor and a reconnect replays
  // only `id > since`, so a genuine reconnect never re-delivers a seen frame, and
  // the single tab-wide `useChatEventStream` subscription means no live frame is
  // dispatched to two store patchers. These tests prove the reducer STILL converges
  // for the id-addressed cases if a frame is nonetheless folded twice (defence in
  // depth), so the "reconnect burst" scenario can never double a count or a list.
  const msg = (id: string, content = 'x') => ({
    id,
    sessionId: 'sess-1',
    userId: 'u',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    payload: { id, role: 'assistant', content },
  })

  test('message.created applied twice keeps ONE message and bumps messageCount ONCE', () => {
    const base = makeSession({ messages: [], messageCount: 0 } as Partial<UiSession>)
    const event = ev({ type: 'message.created', sessionId: 'sess-1', message: msg('m1') })
    const once = applyStreamEventToSession(base, event)
    const twice = applyStreamEventToSession(once, event)
    expect(twice.messages.map((m) => m.id)).toEqual(['m1'])
    // The `exists` id-guard makes the count increment conditional, so a re-applied
    // create is a no-op on the counter — it cannot drift above the real message set.
    expect((twice as unknown as { messageCount: number }).messageCount).toBe(1)
  })

  test('message.updated applied twice keeps ONE message (no append on the second fold)', () => {
    const base = makeSession({ messages: [{ id: 'm1' }] as unknown as UiSession['messages'] })
    const event = ev({ type: 'message.updated', sessionId: 'sess-1', message: msg('m1', 'grown') })
    const once = applyStreamEventToSession(base, event)
    const twice = applyStreamEventToSession(once, event)
    expect(twice.messages).toHaveLength(1)
    expect(twice.messages[0].id).toBe('m1')
  })

  test('hitl.resolved applied twice stays cleared (the second fold is an inert no-op)', () => {
    const base = makeSession({
      pendingInteraction: { request: { id: 'r1' } },
    } as unknown as Partial<UiSession>)
    const event = ev({ type: 'hitl.resolved', sessionId: 'sess-1', requestId: 'r1' })
    const once = applyStreamEventToSession(base, event)
    const twice = applyStreamEventToSession(once, event)
    expect(twice.pendingInteraction).toBeNull()
    // Once cleared, the requestId guard makes every further clear return the SAME ref.
    expect(applyStreamEventToSession(twice, event)).toBe(twice)
  })

  test('message.removed applied twice is a stable no-op on the second fold', () => {
    const base = makeSession({
      messages: [{ id: 'm1' }, { id: 'm2' }] as unknown as UiSession['messages'],
    })
    const event = ev({ type: 'message.removed', sessionId: 'sess-1', messageId: 'm1' })
    const once = applyStreamEventToSession(base, event)
    const twice = applyStreamEventToSession(once, event)
    expect(twice.messages.map((m) => m.id)).toEqual(['m2'])
    expect(twice).toBe(once)
  })
})

describe('applyStreamEventToSession — streamingMessageId (cross-message streaming bug)', () => {
  // The transcript keys its streaming visuals on this id. The bug it guards:
  // deriving "streaming" positionally made the PREVIOUS assistant reply re-type
  // from scratch during the send→echo round-trip window.
  test('run.started replaces the previous run stream target with its own row', () => {
    // The event carries the new run's assistant slot id — the old target is
    // overwritten (never carried), and the new one is adopted immediately so the
    // skeleton stays live for the whole prefill (nulling here was the multi-
    // second "empty void" after every send).
    const session = makeSession({ streamingMessageId: 'old-assistant' })
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'run.started', sessionId: 'sess-1', messageId: 'm-new-run' }),
    )
    expect(next.streamingMessageId).toBe('m-new-run')
  })

  test('run.started after the assistant echo keeps pointing at the claimed row', () => {
    // Server order: message.created(user) → message.created(assistant) →
    // run.started(messageId = assistant row id). The echo already claimed the
    // optimistic skeleton and set the target; run.started must not blank it.
    let session = makeSession({
      isRunning: true,
      streamingMessageId: 'optimistic-assistant-1',
      messages: [
        { id: 'optimistic-user-1', role: 'user', content: 'hi', optimistic: true },
        { id: 'optimistic-assistant-1', role: 'assistant', items: [], optimistic: true },
      ] as never,
    })
    session = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-real-assistant', payload: { role: 'assistant', items: [] } },
      }),
    )
    expect(session.streamingMessageId).toBe('m-real-assistant')
    session = applyStreamEventToSession(
      session,
      ev({ type: 'run.started', sessionId: 'sess-1', messageId: 'm-real-assistant' }),
    )
    expect(session.streamingMessageId).toBe('m-real-assistant')
  })

  test('run.completed and run.failed clear the stream target', () => {
    for (const type of ['run.completed', 'run.failed']) {
      const session = makeSession({ isRunning: true, streamingMessageId: 'm-live' })
      const next = applyStreamEventToSession(session, ev({ type, sessionId: 'sess-1' }))
      expect(next.streamingMessageId).toBeNull()
    }
  })

  test('an assistant message.created during a run becomes the stream target', () => {
    const session = makeSession({ isRunning: true, streamingMessageId: null })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-new', payload: { role: 'assistant', items: [] } },
      }),
    )
    expect(next.streamingMessageId).toBe('m-new')
  })

  test('a user message.created never becomes the stream target', () => {
    const session = makeSession({ isRunning: true, streamingMessageId: null })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-user', payload: { role: 'user', items: [] } },
      }),
    )
    expect(next.streamingMessageId).toBeNull()
  })

  test('an assistant message.created while idle does not set a stream target', () => {
    const session = makeSession({ isRunning: false, streamingMessageId: null })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-idle', payload: { role: 'assistant', items: [] } },
      }),
    )
    expect(next.streamingMessageId).toBeNull()
  })

  test('message.delta marks its message as the stream target (mid-stream reconnect)', () => {
    const session = makeSession({
      isRunning: true,
      streamingMessageId: null,
      messages: [
        { id: 'm1', items: [{ id: 'text-0', type: 'text', text: 'Hi', status: 'completed' }] },
      ] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.delta',
        sessionId: 'sess-1',
        messageId: 'm1',
        textItemId: 'text-0',
        textAppend: '!',
      }),
    )
    expect(next.streamingMessageId).toBe('m1')
  })
})

describe('applyStreamEventToSession — optimistic send reconciliation', () => {
  // The composer paints placeholder rows on Enter so the send has no dead air.
  // The echo must TAKE the placeholder's slot — appending beside it would show
  // the message twice, then flicker as the placeholder is removed.
  const withPlaceholders = () =>
    makeSession({
      isRunning: true,
      streamingMessageId: 'optimistic-assistant-1',
      messages: [
        { id: 'm-old', role: 'assistant', content: 'previous reply' },
        { id: 'optimistic-user-1', role: 'user', content: 'hello', optimistic: true },
        { id: 'optimistic-assistant-1', role: 'assistant', items: [], optimistic: true },
      ] as never,
    })

  test('the user echo replaces the user placeholder in place', () => {
    const next = applyStreamEventToSession(
      withPlaceholders(),
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-real-user', payload: { role: 'user', content: 'hello' } },
      }),
    )
    expect(next.messages.map((m) => m.id)).toEqual([
      'm-old',
      'm-real-user',
      'optimistic-assistant-1',
    ])
    expect(next.messages.some((m) => m.optimistic && m.role === 'user')).toBe(false)
  })

  test('the assistant echo replaces the skeleton and takes over the stream target', () => {
    const next = applyStreamEventToSession(
      withPlaceholders(),
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-real-assistant', payload: { role: 'assistant', items: [] } },
      }),
    )
    expect(next.messages.map((m) => m.id)).toEqual([
      'm-old',
      'optimistic-user-1',
      'm-real-assistant',
    ])
    expect(next.streamingMessageId).toBe('m-real-assistant')
  })

  test('the assistant echo rebinds a notice anchored to its optimistic skeleton', () => {
    const session = withPlaceholders()
    session.messages.push({
      id: 'notice-after-skeleton',
      role: 'system',
      afterMessageId: 'optimistic-assistant-1',
      clientOnly: true,
    } as never)
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-real-assistant', payload: { role: 'assistant', items: [] } },
      }),
    )

    expect(
      next.messages.find((message) => message.id === 'notice-after-skeleton')?.afterMessageId,
    ).toBe('m-real-assistant')
  })

  test('a correlated user echo claims its own slot even when delivered out of FIFO order', () => {
    const session = makeSession({
      messages: [
        { id: 'm-old', role: 'assistant', content: 'previous reply' },
        { id: 'optimistic-user-a', role: 'user', content: 'A', optimistic: true },
        { id: 'optimistic-user-b', role: 'user', content: 'B', optimistic: true },
      ] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-real-b',
          payload: {
            role: 'user',
            content: 'B',
            clientMessageIds: ['optimistic-user-b'],
          },
        },
      }),
    )

    expect(next.messages.map((message) => message.id)).toEqual([
      'm-old',
      'optimistic-user-a',
      'm-real-b',
    ])
    expect(next.messages[2]?.renderKey).toBe('optimistic-user-b')
  })

  test('a merged queued turn replaces every optimistic row it represents without reordering', () => {
    const session = makeSession({
      messages: [
        { id: 'm-old', role: 'assistant', content: 'previous reply' },
        { id: 'optimistic-user-a', role: 'user', content: 'A', optimistic: true },
        { id: 'optimistic-user-b', role: 'user', content: 'B', optimistic: true },
      ] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-real-band',
          payload: {
            role: 'user',
            content: 'A\n\n---\n\nB',
            clientMessageIds: ['optimistic-user-a', 'optimistic-user-b'],
          },
        },
      }),
    )

    expect(next.messages.map((message) => message.id)).toEqual(['m-old', 'm-real-band'])
    expect(next.messages[1]?.renderKey).toBe('optimistic-user-a')
  })

  test('a merged queued turn rebinds anchors from every optimistic row it consumed', () => {
    const session = makeSession({
      messages: [
        { id: 'optimistic-user-a', role: 'user', content: 'A', optimistic: true },
        { id: 'notice-a', role: 'system', afterMessageId: 'optimistic-user-a', clientOnly: true },
        { id: 'optimistic-user-b', role: 'user', content: 'B', optimistic: true },
        { id: 'notice-b', role: 'system', afterMessageId: 'optimistic-user-b', clientOnly: true },
      ] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-real-band',
          payload: {
            role: 'user',
            content: 'A\n\n---\n\nB',
            clientMessageIds: ['optimistic-user-a', 'optimistic-user-b'],
          },
        },
      }),
    )

    expect(
      next.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.afterMessageId),
    ).toEqual(['m-real-band', 'm-real-band'])
  })

  test('a correlated echo from another tab never claims a local optimistic row', () => {
    const session = makeSession({
      messages: [
        { id: 'optimistic-local', role: 'user', content: 'same', optimistic: true },
        {
          id: 'notice-local',
          role: 'system',
          afterMessageId: 'optimistic-local',
          clientOnly: true,
        },
      ] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-other-tab',
          payload: {
            role: 'user',
            content: 'same',
            clientMessageIds: ['optimistic-other-tab'],
          },
        },
      }),
    )

    expect(next.messages.map((message) => message.id)).toEqual([
      'optimistic-local',
      'notice-local',
      'm-other-tab',
    ])
    expect(next.messages[1]?.afterMessageId).toBe('optimistic-local')
  })

  test('an echo with no placeholder to claim still appends (settled transcript)', () => {
    const session = makeSession({
      messages: [{ id: 'm-old', role: 'assistant', content: 'x' }] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-new', payload: { role: 'user', content: 'hi' } },
      }),
    )
    expect(next.messages.map((m) => m.id)).toEqual(['m-old', 'm-new'])
  })

  test('run.completed drops a placeholder the echo never claimed', () => {
    const next = applyStreamEventToSession(
      withPlaceholders(),
      ev({ type: 'run.completed', sessionId: 'sess-1' }),
    )
    expect(next.messages.map((m) => m.id)).toEqual(['m-old'])
    expect(next.streamingMessageId).toBeNull()
  })

  test('the claim stamps the placeholder id as renderKey (stable row identity)', () => {
    // The transcript keys rows on renderKey ?? id — without the stamp the id
    // swap would remount the row and visibly erase-retype the typing status.
    const next = applyStreamEventToSession(
      withPlaceholders(),
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-real-user', payload: { role: 'user', content: 'hello' } },
      }),
    )
    expect(next.messages.find((m) => m.id === 'm-real-user')?.renderKey).toBe('optimistic-user-1')
  })

  test('full snapshots preserve the claimed renderKey instead of remounting the row', () => {
    const claimed = applyStreamEventToSession(
      withPlaceholders(),
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-real-assistant', payload: { role: 'assistant', items: [] } },
      }),
    )
    const updated = applyStreamEventToSession(
      claimed,
      ev({
        type: 'message.updated',
        sessionId: 'sess-1',
        message: {
          id: 'm-real-assistant',
          payload: {
            role: 'assistant',
            items: [{ id: 'text-1', type: 'text', text: 'streaming', status: 'completed' }],
          },
        },
      }),
    )
    const replayedCreate = applyStreamEventToSession(
      updated,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-real-assistant',
          payload: {
            role: 'assistant',
            items: [{ id: 'text-1', type: 'text', text: 'streaming', status: 'completed' }],
          },
        },
      }),
    )

    expect(claimed.messages.find((m) => m.id === 'm-real-assistant')?.renderKey).toBe(
      'optimistic-assistant-1',
    )
    expect(updated.messages.find((m) => m.id === 'm-real-assistant')?.renderKey).toBe(
      'optimistic-assistant-1',
    )
    expect(replayedCreate.messages.find((m) => m.id === 'm-real-assistant')?.renderKey).toBe(
      'optimistic-assistant-1',
    )
  })

  test('a queued busy-send user row SURVIVES run.completed and its echo claims it later', () => {
    // A send during a live run queues backend-side (no echo until the wake
    // drains) — sweeping its optimistic row at run end made the message vanish
    // and reappear seconds later. The queue publish lands before run.completed,
    // so a non-empty queue gates the user-row sweep; the assistant skeleton is
    // still dropped (its run really did end without claiming it).
    const session = makeSession({
      isRunning: true,
      streamingMessageId: 'optimistic-assistant-1',
      queuedMessages: [{ id: 'q1', text: 'queued' }] as never,
      messages: [
        { id: 'm-old', role: 'assistant', content: 'previous reply' },
        { id: 'optimistic-user-1', role: 'user', content: 'queued', optimistic: true },
        { id: 'optimistic-assistant-1', role: 'assistant', items: [], optimistic: true },
      ] as never,
    })
    const ended = applyStreamEventToSession(
      session,
      ev({ type: 'run.completed', sessionId: 'sess-1' }),
    )
    expect(ended.messages.map((m) => m.id)).toEqual(['m-old', 'optimistic-user-1'])
    // The drained turn's echo then claims the kept row in place.
    const claimed = applyStreamEventToSession(
      ended,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-drained-user', payload: { role: 'user', content: 'queued' } },
      }),
    )
    expect(claimed.messages.map((m) => m.id)).toEqual(['m-old', 'm-drained-user'])
  })

  test('an internal/uiOnly user row never consumes the placeholder — it appends beside it', () => {
    // Mode dividers (uiOnly) and wake/clear turns (isInternal) are user-role
    // rows that are NOT the echo; claiming would morph the typed text into a
    // divider. They fall through to plain append; the real echo claims after.
    const session = withPlaceholders()
    const divided = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-divider',
          payload: { role: 'user', content: 'Mode: plan', uiOnly: true },
        },
      }),
    )
    expect(divided.messages.map((m) => m.id)).toEqual([
      'm-old',
      'optimistic-user-1',
      'optimistic-assistant-1',
      'm-divider',
    ])
    const claimed = applyStreamEventToSession(
      divided,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: { id: 'm-real-user', payload: { role: 'user', content: 'hello' } },
      }),
    )
    expect(claimed.messages.map((m) => m.id)).toEqual([
      'm-old',
      'm-real-user',
      'optimistic-assistant-1',
      'm-divider',
    ])
  })

  test('a standalone mode command settles to exactly one system notice', () => {
    let session = withPlaceholders()
    session = applyStreamEventToSession(
      session,
      ev({ type: 'run.started', sessionId: 'sess-1', messageId: 'm-mode-notice' }),
    )
    session = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-mode-notice',
          payload: {
            role: 'user',
            content: 'Mode changed to plan',
            uiOnly: true,
            systemNotice: {
              kind: 'mode_change',
              tone: 'muted',
              text: 'Mode changed to plan',
            },
          },
        },
      }),
    )
    session = applyStreamEventToSession(
      session,
      ev({ type: 'run.completed', sessionId: 'sess-1', messageId: 'm-mode-notice' }),
    )

    expect(session.messages.map((message) => message.id)).toEqual(['m-old', 'm-mode-notice'])
    expect(session.messages.at(-1)).toMatchObject({
      role: 'system',
      uiOnly: true,
      systemNotice: { kind: 'mode_change', text: 'Mode changed to plan' },
    })
    expect(session.isRunning).toBe(false)
    expect(session.streamingMessageId).toBeNull()
  })

  test('a plugin result replaces its optimistic activity row in place', () => {
    const optimisticId = 'optimistic-assistant-plugin'
    let session = makeSession({
      isRunning: true,
      streamingMessageId: optimisticId,
      messages: [
        {
          id: 'optimistic-user-plugin',
          role: 'user',
          content: '/plugin install owner/review',
          optimistic: true,
        },
        {
          id: optimisticId,
          role: 'system',
          optimistic: true,
          commandOutput: {
            command: '/plugin',
            tone: 'neutral',
            text: 'Installing plugin',
            activity: {
              kind: 'plugin',
              action: 'install',
              state: 'running',
              label: 'Installing plugin',
              subject: 'owner/review',
            },
          },
        },
      ] as never,
    })

    session = applyStreamEventToSession(
      session,
      ev({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-plugin-result',
          payload: {
            role: 'assistant',
            content: 'Installed `review` v1.0.0.',
            uiOnly: true,
            commandOutput: { command: '/plugin', tone: 'success' },
          },
        },
      }),
    )

    expect(session.messages.map((message) => message.id)).toEqual([
      'optimistic-user-plugin',
      'm-plugin-result',
    ])
    expect(session.messages[1]).toMatchObject({
      role: 'system',
      renderKey: optimisticId,
      commandOutput: {
        command: '/plugin',
        tone: 'success',
        text: 'Installed `review` v1.0.0.',
      },
    })

    session = applyStreamEventToSession(
      session,
      ev({ type: 'run.completed', sessionId: 'sess-1', messageId: 'm-plugin-result' }),
    )
    expect(session.messages.map((message) => message.id)).toEqual(['m-plugin-result'])
  })

  test('run.completed keeps a settled transcript byte-identical', () => {
    const session = makeSession({
      isRunning: true,
      messages: [{ id: 'm1', role: 'assistant', content: 'done' }] as never,
    })
    const next = applyStreamEventToSession(
      session,
      ev({ type: 'run.completed', sessionId: 'sess-1' }),
    )
    expect(next.messages).toBe(session.messages)
  })
})

describe('applyStreamEventToSession — a second HITL request must not evict the first', () => {
  // Two requests can be outstanding at once: two parallel `write`s that both need
  // approval, or a background sub-agent whose confirm routes UP to this parent
  // session. The old single slot let the newcomer overwrite the incumbent — its
  // card vanished mid-question and whoever awaited it blocked until timeout.
  const req = (id: string, sourceSessionId?: string) =>
    ev({
      type: 'hitl.requested',
      sessionId: 'sess-1',
      request: { kind: 'ask', requestId: id, sourceSessionId, title: id, payload: {} },
    })

  test('the first stays in the overlay; the second waits behind it', () => {
    const first = applyStreamEventToSession(makeSession(), req('r1'))
    const second = applyStreamEventToSession(first, req('r2'))

    expect(second.pendingInteraction?.request.id).toBe('r1')
    expect(second.pendingInteractionQueue.map((q) => q.request.id)).toEqual(['r2'])
  })

  test('answering the head promotes the next waiter', () => {
    let s = applyStreamEventToSession(makeSession(), req('r1'))
    s = applyStreamEventToSession(s, req('r2'))
    s = applyStreamEventToSession(s, req('r3'))
    s = applyStreamEventToSession(
      s,
      ev({ type: 'hitl.resolved', sessionId: 'sess-1', requestId: 'r1' }),
    )

    expect(s.pendingInteraction?.request.id).toBe('r2') // oldest first — not a stack
    expect(s.pendingInteractionQueue.map((q) => q.request.id)).toEqual(['r3'])
  })

  test('answering the last one leaves the overlay empty', () => {
    let s = applyStreamEventToSession(makeSession(), req('r1'))
    s = applyStreamEventToSession(
      s,
      ev({ type: 'hitl.resolved', sessionId: 'sess-1', requestId: 'r1' }),
    )
    expect(s.pendingInteraction).toBeNull()
    expect(s.pendingInteractionQueue).toEqual([])
  })

  test('root completion preserves requests created by descendants', () => {
    let s = applyStreamEventToSession(makeSession(), req('root', 'sess-1'))
    s = applyStreamEventToSession(s, req('child', 'child-1'))
    s = applyStreamEventToSession(s, req('grandchild', 'grandchild-1'))
    s = applyStreamEventToSession(s, ev({ type: 'run.completed', sessionId: 'sess-1' }))

    expect(s.pendingInteraction?.request.id).toBe('child')
    expect(s.pendingInteractionQueue.map((q) => q.request.id)).toEqual(['grandchild'])
  })

  test("child completion removes only that child's routed requests", () => {
    let s = applyStreamEventToSession(makeSession(), req('child-a', 'child-1'))
    s = applyStreamEventToSession(s, req('child-b', 'child-2'))
    s = applyStreamEventToSession(s, req('child-a-queued', 'child-1'))

    s = removeHitlInteractionsFromSource(s, 'child-1')

    expect(s.pendingInteraction?.request.id).toBe('child-b')
    expect(s.pendingInteractionQueue).toEqual([])
  })

  test('a re-published request refreshes in place instead of queueing a twin', () => {
    // A reconnect replays the live request; it must not become its own second copy.
    const first = applyStreamEventToSession(makeSession(), req('r1'))
    const again = applyStreamEventToSession(first, req('r1'))

    expect(again.pendingInteraction?.request.id).toBe('r1')
    expect(again.pendingInteractionQueue).toEqual([])
  })

  test('a QUEUED request that resolves unseen is dropped without disturbing the head', () => {
    // It timed out, or the sub-agent that asked was stopped.
    let s = applyStreamEventToSession(makeSession(), req('r1'))
    s = applyStreamEventToSession(s, req('r2'))
    s = applyStreamEventToSession(
      s,
      ev({ type: 'hitl.resolved', sessionId: 'sess-1', requestId: 'r2' }),
    )

    expect(s.pendingInteraction?.request.id).toBe('r1')
    expect(s.pendingInteractionQueue).toEqual([])
  })

  test('the run ending clears the queue too — a dead request cannot be answered', () => {
    // Leaving one would let a reconnect resurrect it into a 409 on submit.
    let s = applyStreamEventToSession(makeSession(), req('r1'))
    s = applyStreamEventToSession(s, req('r2'))
    s = applyStreamEventToSession(s, ev({ type: 'run.completed', sessionId: 'sess-1' }))

    expect(s.pendingInteraction).toBeNull()
    expect(s.pendingInteractionQueue).toEqual([])
  })
})

describe('applyStreamEventToSession — request_secret rides the live hitl path', () => {
  // The live-event mapping here is a SEPARATE copy of the kind switch in
  // converters/fromHitlEvent — a kind missed here shows up only after a
  // reconnect resync, never live. This pins the branch.
  test('maps the typed value-free request into the overlay slot', () => {
    const payload = {
      action: 'create' as const,
      key: 'API_KEY',
      reason: 'Needed to call the API',
      type: 'api_key' as const,
      tags: [],
    }
    const s = applyStreamEventToSession(
      makeSession(),
      ev({
        type: 'hitl.requested',
        sessionId: 'sess-1',
        request: {
          kind: 'request_secret',
          requestId: 'r-sec',
          title: 'Secret needed',
          payload,
        },
      }),
    )
    expect(s.pendingInteraction).toEqual({
      kind: 'request_secret',
      request: {
        id: 'r-sec',
        kind: 'request_secret',
        title: 'Secret needed',
        payload,
      },
    })
  })
})
