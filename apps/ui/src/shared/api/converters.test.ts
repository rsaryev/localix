import { describe, expect, test } from 'bun:test'

import { toUiMessage, toUiSession, toUiSessionSummary } from './converters'
import { uiSessionSummary } from './session-summary'
import { applyStreamEventToSession } from './applyStreamEvent'
import type { PersistedMessage, SessionDetail, SessionSummary } from './contracts'

const persisted = (over: Record<string, unknown> = {}): PersistedMessage =>
  ({
    id: 'm1',
    payload: { role: 'assistant', content: 'hi', status: 'completed' },
    ...over,
  }) as unknown as PersistedMessage

const summary = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    id: 's1',
    title: 'T',
    isPinned: false,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T01:00:00.000Z',
    runtimeStatus: 'idle',
    ...over,
  }) as unknown as SessionSummary

const detail = (over: Partial<SessionDetail> = {}): SessionDetail =>
  ({
    id: 's1',
    title: 'T',
    isPinned: false,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T01:00:00.000Z',
    messages: [],
    ...over,
  }) as unknown as SessionDetail

describe('toUiMessage', () => {
  test('lifts payload fields and branch metadata', () => {
    const m = toUiMessage(persisted({ branch: { index: 2, count: 5 } }))
    expect(m).toMatchObject({
      id: 'm1',
      role: 'assistant',
      content: 'hi',
      status: 'completed',
      branchIndex: 2,
      branchCount: 5,
    })
  })

  test('preserves the exact assistant continuation link after refetch', () => {
    const m = toUiMessage(
      persisted({
        payload: {
          id: 'm1',
          role: 'assistant',
          content: 'continued',
          continuedFromMessageId: 'earlier',
        },
      }),
    )
    expect(m.continuedFromMessageId).toBe('earlier')
  })

  test('branch metadata is undefined when absent (drives the switcher off)', () => {
    const m = toUiMessage(persisted())
    expect(m.branchIndex).toBeUndefined()
    expect(m.branchCount).toBeUndefined()
  })

  test('lifts the persisted createdAt timestamp', () => {
    const m = toUiMessage(persisted({ createdAt: '2026-07-03T14:41:00.000Z' }))
    expect(m.createdAt).toBe('2026-07-03T14:41:00.000Z')
  })

  test('carries the read-model-only deferred tool ids into the UI message', () => {
    const m = toUiMessage(persisted({ deferredToolItemIds: ['tool-a', 'tool-b'] }))
    expect(m.deferredToolItemIds).toEqual(['tool-a', 'tool-b'])
  })

  test('maps the payload origin tag to wakeSource for autonomous-wake provenance', () => {
    const m = toUiMessage(persisted({ payload: { role: 'user', content: 'tick', origin: 'loop' } }))
    expect(m.wakeSource).toBe('loop')
  })

  test('wakeSource is undefined when no origin is persisted', () => {
    expect(toUiMessage(persisted()).wakeSource).toBeUndefined()
  })

  test('projects durable application notices to system rows', () => {
    const m = toUiMessage(
      persisted({
        payload: {
          role: 'user',
          content: 'Mode changed to plan',
          uiOnly: true,
          systemNotice: { kind: 'mode_change', tone: 'muted', text: 'Mode changed to plan' },
        },
      }),
    )

    expect(m).toMatchObject({
      role: 'system',
      uiOnly: true,
      systemNotice: { kind: 'mode_change', text: 'Mode changed to plan' },
    })
  })

  test('projects slash output to system chrome with its persisted content', () => {
    const m = toUiMessage(
      persisted({
        payload: {
          role: 'assistant',
          content: '**Available models**',
          uiOnly: true,
          commandOutput: { command: '/model', tone: 'neutral' },
        },
      }),
    )

    expect(m.role).toBe('system')
    expect(m.commandOutput).toEqual({
      command: '/model',
      tone: 'neutral',
      text: '**Available models**',
    })
  })
})

describe('toUiSessionSummary', () => {
  test('summaries start with no messages or interaction', () => {
    const s = toUiSessionSummary(summary())
    expect(s.messages).toEqual([])
    expect(s.bodyLoaded).toBe(false)
    expect(s.pendingInteraction).toBeNull()
  })

  test('timestamps are parsed to epoch ms', () => {
    const s = toUiSessionSummary(summary({}))
    expect(s.createdAt).toBe(Date.parse('2026-06-13T00:00:00.000Z'))
  })

  test('isRunning is derived from runtimeStatus', () => {
    expect(toUiSessionSummary(summary({ runtimeStatus: 'running' })).isRunning).toBe(true)
    expect(toUiSessionSummary(summary({ runtimeStatus: 'idle' })).isRunning).toBe(false)
  })

  test('absent collections fall back to safe defaults', () => {
    const s = toUiSessionSummary(summary())
    expect(s.pinnedSkills).toEqual([])
    expect(s.sessionTiming).toBeNull()
    expect(s.lspServers).toEqual([])
  })
})

describe('uiSessionSummary — a held session cut back to a roster row', () => {
  const preview = { text: 'last', author: { kind: 'agent', agentId: 'a1' } }

  test('projecting a summary changes nothing: the two describe one shape', () => {
    // The pin against drift: a field added to the summary converter and not here (or the
    // reverse) makes these differ.
    const row = toUiSessionSummary(
      summary({ lastMessage: preview, messageCount: 3 } as unknown as Partial<SessionSummary>),
    )
    expect(uiSessionSummary(row)).toEqual(row)
  })

  test('a loaded body loses what only a detail says, so it is "not loaded" again', () => {
    // A body in the launch frame was painted as loaded with an approved plan still
    // `presented`, and the open chat never refetched the truth.
    const body = toUiSession(
      detail({
        messages: [persisted()],
        plans: [{ id: 'p1', version: 1, status: 'presented' }],
      } as unknown as Partial<SessionDetail>),
    )
    expect(body.plans).toHaveLength(1)
    const row = uiSessionSummary(body)
    expect(row.bodyLoaded).toBe(false)
    expect(row.messages).toEqual([])
    expect('plans' in row).toBe(false)
    expect(row.id).toBe(body.id)
  })
})

describe('toUiSession', () => {
  test('marks the conversation body as loaded even when it is genuinely empty', () => {
    expect(toUiSession(detail({ messages: [] })).bodyLoaded).toBe(true)
    // A root's plans ride the detail; a detail without them stays "unknown", never "none".
    const plans = [{ id: 'p1', status: 'approved' }] as never
    expect(toUiSession(detail({ messages: [], plans })).plans).toBe(plans)
    expect('plans' in toUiSession(detail({ messages: [] }))).toBe(false)
  })

  test('restores an active terminal wait from the server detail snapshot', () => {
    let session = toUiSession(
      detail({ terminalWaits: [{ terminalId: 'pty-1', label: 'waiting for prompt' }] }),
    )
    expect(session.activePhase).toEqual({
      id: 'terminal-wait:pty-1',
      label: 'waiting for prompt',
    })
    expect(session.messages.at(-1)?.systemNotice?.text).toBe('Waiting for background terminal')
    session = applyStreamEventToSession(session, {
      type: 'terminal.waiting',
      sessionId: session.id,
      terminalId: 'pty-1',
      active: true,
      label: 'waiting for prompt',
    })
    expect(session.messages.filter((message) => message.terminalLifecycle)).toHaveLength(1)
  })

  test('maps messages through toUiMessage', () => {
    const s = toUiSession(
      detail({ messages: [persisted({ id: 'a' }), persisted({ id: 'b' })] as never }),
    )
    expect(s.messages.map((m) => m.id)).toEqual(['a', 'b'])
  })

  test('hydrates the authoritative all-history usage instead of re-summing messages', () => {
    const sessionUsage = {
      inputTokens: 900_000,
      outputTokens: 100_000,
      totalTokens: 1_000_000,
      cachedInputTokens: 700_000,
      cacheWriteTokens: 25_000,
      totalCost: 12.5,
      costSource: 'actual' as const,
      isSummary: true,
    }
    const s = toUiSession(
      detail({
        messages: [persisted({ id: 'tail' })],
        messageCount: 100_000,
        sessionUsage,
      }),
    )
    expect(s.sessionUsage).toBe(sessionUsage)
  })

  test('isRunning comes from detail.isRunning (NOT runtimeStatus) — distinct from the summary path', () => {
    // runtimeStatus says running, but the explicit flag wins for details.
    expect(
      toUiSession(detail({ isRunning: false, runtimeStatus: 'running' as never })).isRunning,
    ).toBe(false)
    expect(toUiSession(detail({ isRunning: true })).isRunning).toBe(true)
    expect(toUiSession(detail({ isRunning: undefined })).isRunning).toBe(false) // ?? false default
  })

  test('converts an ask interaction into the UI shape', () => {
    const s = toUiSession(
      detail({
        pendingInteraction: {
          kind: 'ask',
          requestId: 'r1',
          title: 'Pick',
          payload: { foo: 1 },
        } as never,
      }),
    )
    expect(s.pendingInteraction).toMatchObject({
      kind: 'ask',
      request: { id: 'r1', kind: 'ask', title: 'Pick', payload: { foo: 1 } },
    })
  })

  test('converts a request_secret interaction into the UI shape (value-free request leg)', () => {
    const payload = {
      action: 'create' as const,
      key: 'API_KEY',
      reason: 'Needed to call the API',
      type: 'api_key' as const,
      tags: [],
    }
    const s = toUiSession(
      detail({
        pendingInteraction: {
          kind: 'request_secret',
          requestId: 'r9',
          title: 'Secret needed',
          payload,
        } as never,
      }),
    )
    expect(s.pendingInteraction).toEqual({
      kind: 'request_secret',
      request: {
        id: 'r9',
        kind: 'request_secret',
        title: 'Secret needed',
        payload,
      },
    })
  })

  test('rebuilds the waiters behind the head from the detail, not just the head', () => {
    // The reconnect resync rebuilds the session through here, AFTER an await — so it
    // lands on top of the replayed `hitl.requested` frames and erases them. Anything not
    // restored here strands its caller until it times out. A second client carried the
    // identical bug and the identical wrong comment.
    const s = toUiSession(
      detail({
        pendingInteraction: { kind: 'confirm', requestId: 'r1', title: 'first' } as never,
        pendingInteractions: [
          { kind: 'confirm', requestId: 'r1', title: 'first' },
          { kind: 'confirm', requestId: 'r2', title: 'second' },
          { kind: 'ask', requestId: 'r3', title: 'third', payload: {} },
        ] as never,
      }),
    )
    expect(s.pendingInteraction).toMatchObject({ request: { id: 'r1' } })
    // The head is NOT repeated: answering it promotes r2, and a duplicate would make the
    // user answer the same prompt twice.
    expect(s.pendingInteractionQueue.map((q) => q.request.id)).toEqual(['r2', 'r3'])
  })

  test('drops an unknown-kind waiter instead of queueing a card nothing can render', () => {
    // toUiPendingInteraction returns null for a kind this client does not know; a null in
    // the queue would crash the overlay that promotes it.
    const s = toUiSession(
      detail({
        pendingInteraction: { kind: 'confirm', requestId: 'r1', title: 'first' } as never,
        pendingInteractions: [
          { kind: 'confirm', requestId: 'r1', title: 'first' },
          { kind: 'from-the-future', requestId: 'r2', title: 'huh' },
        ] as never,
      }),
    )
    expect(s.pendingInteractionQueue).toEqual([])
  })

  test('leaves the queue empty when there are no waiters — the reverse direction', () => {
    // Guards against inventing a queue: an ordinary session must not grow a phantom
    // prompt, and a server too old to send the field must stay silent.
    expect(toUiSession(detail({})).pendingInteractionQueue).toEqual([])
  })

  test('a null / unknown-kind interaction maps to null', () => {
    expect(toUiSession(detail({ pendingInteraction: null })).pendingInteraction).toBeNull()
    expect(
      toUiSession(detail({ pendingInteraction: { kind: 'mystery' } as never })).pendingInteraction,
    ).toBeNull()
  })
})

test('external CLI choice survives detail, list and persisted launch summaries', () => {
  const metadata = { externalAgentProvider: 'codex', externalAgentSessionKey: 'codex:native' }
  const list = toUiSessionSummary(summary(metadata))
  const body = toUiSession(detail(metadata))
  expect(list).toMatchObject(metadata)
  expect(body).toMatchObject(metadata)
  expect(uiSessionSummary(body)).toMatchObject(metadata)
})
