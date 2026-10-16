import { describe, expect, test } from 'bun:test'
import { applyStreamEventToSession } from '@/shared/api/applyStreamEvent'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import type { Message } from '../model/types'
import {
  createTranscriptProjectionSelector,
  type TranscriptProjectionMetrics,
} from './transcriptProjection'

const message = (value: Partial<Message> & Pick<Message, 'id' | 'role'>): Message =>
  value as Message

const session = (over: Partial<UiSession> = {}) =>
  ({
    id: 'sess-1',
    messages: [],
    isRunning: true,
    pendingInteraction: null,
    pendingInteractionQueue: [],
    activePhase: null,
    ...over,
  }) as UiSession

const event = (value: Record<string, unknown>) => value as AgentStreamEvent

describe('transcript projection performance contract', () => {
  test('keeps a notice beside its queued message when the optimistic id is claimed', () => {
    const project = createTranscriptProjectionSelector()
    let next = session({
      messages: [
        { id: 'assistant-live', role: 'assistant', content: 'streaming' },
        { id: 'optimistic-user-a', role: 'user', content: 'A', optimistic: true },
      ] as UiSession['messages'],
    })
    next = applyStreamEventToSession(
      next,
      event({
        type: 'terminal.waiting',
        sessionId: 'sess-1',
        terminalId: 'pty-claim',
        active: true,
        label: 'waiting',
      }),
    )
    const noticeId = next.messages.at(-1)!.id
    next = {
      ...next,
      messages: [
        ...next.messages,
        { id: 'optimistic-user-b', role: 'user', content: 'B', optimistic: true },
      ],
    }
    const projectedBefore = project(next.messages)
    const keysBefore = projectedBefore.map((entry) => entry.renderKey ?? entry.id)
    expect(projectedBefore.map((entry) => entry.id)).toEqual([
      'assistant-live',
      'optimistic-user-a',
      noticeId,
      'optimistic-user-b',
    ])

    next = applyStreamEventToSession(
      next,
      event({
        type: 'message.created',
        sessionId: 'sess-1',
        message: {
          id: 'm-real-a',
          payload: {
            role: 'user',
            content: 'A',
            clientMessageIds: ['optimistic-user-a'],
          },
        },
      }),
    )

    expect(next.messages.find((entry) => entry.id === noticeId)?.afterMessageId).toBe('m-real-a')
    const projectedAfter = project(next.messages)
    expect(projectedAfter.map((entry) => entry.id)).toEqual([
      'assistant-live',
      'm-real-a',
      noticeId,
      'optimistic-user-b',
    ])
    expect(projectedAfter.map((entry) => entry.renderKey ?? entry.id)).toEqual(keysBefore)
  })

  test('reuses identity and visits only the append delta', () => {
    const metrics: TranscriptProjectionMetrics[] = []
    const project = createTranscriptProjectionSelector((value) => metrics.push(value))
    const firstMessages = [
      message({ id: 'u1', role: 'user', content: 'hello' }),
      message({ id: 'hidden', role: 'user', isInternal: true }),
    ]

    const first = project(firstMessages)
    expect(project(firstMessages)).toBe(first)

    const appended = message({ id: 'a1', role: 'assistant', content: 'hi' })
    const second = project([
      ...firstMessages,
      appended,
      message({ id: 'hidden-2', role: 'user', isInternal: true }),
    ])

    expect(second).toEqual([firstMessages[0], appended])
    expect(second[0]).toBe(first[0])
    expect(metrics).toEqual([
      { mode: 'full', messagesVisited: 2 },
      { mode: 'append', messagesVisited: 2 },
    ])
  })

  test('falls back to the exact notice interleave when an append can reorder rows', () => {
    const metrics: TranscriptProjectionMetrics[] = []
    const project = createTranscriptProjectionSelector((value) => metrics.push(value))
    const user = message({ id: 'u1', role: 'user' })
    const assistant = message({ id: 'a1', role: 'assistant' })
    const base = [user, assistant]
    project(base)

    const anchored = message({ id: 'notice-a', role: 'system', afterMessageId: 'u1' })
    const leading = message({ id: 'notice-leading', role: 'system', afterMessageId: null })
    const orphan = message({ id: 'notice-orphan', role: 'system', afterMessageId: 'gone' })
    const projected = project([...base, anchored, leading, orphan])

    expect(projected).toEqual([leading, user, anchored, assistant, orphan])
    expect(metrics.at(-1)).toEqual({ mode: 'full', messagesVisited: 5 })
  })

  test('keeps durable unanchored system rows at their persisted sequence boundary', () => {
    const project = createTranscriptProjectionSelector()
    const user = message({ id: 'u1', role: 'user' })
    const notice = message({
      id: 'model',
      role: 'system',
      uiOnly: true,
      systemNotice: { kind: 'model_change', tone: 'neutral', text: 'Model changed to sonnet' },
    })
    const assistant = message({ id: 'a1', role: 'assistant' })

    expect(project([user, notice, assistant])).toEqual([user, notice, assistant])
  })

  test('keeps a 100k-message transcript on the O(delta) append path', () => {
    const metrics: TranscriptProjectionMetrics[] = []
    const project = createTranscriptProjectionSelector((value) => metrics.push(value))
    const large = Array.from({ length: 100_000 }, (_, index) =>
      message({
        id: `m-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index}`,
      }),
    )

    const first = project(large)
    const appended = message({ id: 'm-100000', role: 'assistant', content: 'tail' })
    const next = [...large, appended]
    const second = project(next)

    expect(first).toBe(large)
    expect(second).toBe(next)
    expect(first).toHaveLength(100_000)
    expect(second).toHaveLength(100_001)
    expect(second[99_999]).toBe(first[99_999])
    expect(second[100_000]).toBe(appended)
    expect(metrics).toEqual([
      { mode: 'full', messagesVisited: 100_000 },
      { mode: 'append', messagesVisited: 1 },
    ])
  })

  test('projects a streaming tail replacement in O(1) without copying the transcript', () => {
    const metrics: TranscriptProjectionMetrics[] = []
    const project = createTranscriptProjectionSelector((value) => metrics.push(value))
    const large = Array.from({ length: 100_000 }, (_, index) =>
      message({ id: `m-${index}`, role: index % 2 === 0 ? 'user' : 'assistant' }),
    )
    project(large)

    const updatedTail = message({ id: 'm-99999', role: 'assistant', content: 'stream delta' })
    const next = [...large.slice(0, -1), updatedTail]
    const projected = project(next)

    expect(projected).toBe(next)
    expect(projected.at(-1)).toBe(updatedTail)
    expect(metrics.at(-1)).toEqual({ mode: 'tail', messagesVisited: 1 })
  })
})

/**
 * The identity fast path above only applies to a transcript with NO notices. The first
 * time a user changes model / agent / reasoning the store paints a client-only
 * notice, and from then on the projection is its own array — which used to send every
 * subsequent token delta through a full rebuild (Set + Map + rescan) for the rest of the
 * session. These pin the incremental path that replaced it, and, more importantly, that
 * it agrees with the full rebuild it skips.
 */
describe('transcript projection with notices', () => {
  const notice = (id: string, after: string | null | undefined) =>
    message({ id, role: 'system', afterMessageId: after } as Partial<Message> &
      Pick<Message, 'id' | 'role'>)

  test('a streaming tail replacement reuses the projection instead of rebuilding it', () => {
    const metrics: TranscriptProjectionMetrics[] = []
    const project = createTranscriptProjectionSelector((value) => metrics.push(value))
    const base = [
      message({ id: 'm-0', role: 'user' }),
      notice('sys-1', 'm-0'), // "model changed to …"
      ...Array.from({ length: 500 }, (_, i) =>
        message({ id: `m-${i + 1}`, role: i % 2 === 0 ? 'assistant' : 'user' }),
      ),
    ]
    const first = project(base)
    expect(metrics.at(-1)?.mode).toBe('full')

    const updatedTail = message({ id: 'm-500', role: 'assistant', content: 'delta' })
    const projected = project([...base.slice(0, -1), updatedTail])

    expect(metrics.at(-1)).toEqual({ mode: 'tail', messagesVisited: 1 })
    expect(projected.at(-1)).toBe(updatedTail)
    // Everything before the tail is carried over by reference — no rebuild.
    expect(projected.length).toBe(first.length)
    for (let i = 0; i < projected.length - 1; i += 1) expect(projected[i]).toBe(first[i])
  })

  test('the incremental path produces exactly what a full rebuild would', () => {
    // Deterministic pseudo-random transcripts: notices anchored to real messages, to
    // missing ids (trailing), before the first message (leading), and durable ones with
    // no anchor at all — every branch the full projection distinguishes.
    let seed = 12345
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

    for (let trial = 0; trial < 40; trial += 1) {
      const items: Message[] = []
      const realIds: string[] = []
      for (let i = 0; i < 25; i += 1) {
        const roll = rand()
        if (roll < 0.25 && realIds.length > 0) {
          const pick = rand()
          const anchor =
            pick < 0.5
              ? realIds[Math.floor(rand() * realIds.length)]!
              : pick < 0.7
                ? 'missing-anchor'
                : pick < 0.85
                  ? null
                  : undefined
          items.push(notice(`sys-${trial}-${i}`, anchor))
        } else if (roll < 0.35) {
          items.push(message({ id: `int-${trial}-${i}`, role: 'assistant', isInternal: true }))
        } else {
          const id = `m-${trial}-${i}`
          realIds.push(id)
          items.push(message({ id, role: i % 2 === 0 ? 'user' : 'assistant' }))
        }
      }
      // Guarantee a real, non-internal last message — the streaming tail.
      const tailId = `m-${trial}-tail`
      items.push(message({ id: tailId, role: 'assistant', content: 'v0' }))

      const incremental = createTranscriptProjectionSelector()
      incremental(items)
      const next = [
        ...items.slice(0, -1),
        message({ id: tailId, role: 'assistant', content: 'v1' }),
      ]
      const viaIncremental = incremental(next)

      // A selector that has never seen the earlier array can only do a full rebuild.
      const viaFullRebuild = createTranscriptProjectionSelector()(next)

      expect(viaIncremental.map((m) => m.id)).toEqual(viaFullRebuild.map((m) => m.id))
      // The streaming message carries the new text — it is not necessarily the LAST
      // element, since a notice with an unresolvable anchor is emitted after it.
      expect(viaIncremental.find((m) => m.id === tailId)?.content).toBe('v1')
    }
  })

  test('a notice anchored AFTER the streaming tail still forces a full rebuild', () => {
    const metrics: TranscriptProjectionMetrics[] = []
    const project = createTranscriptProjectionSelector((value) => metrics.push(value))
    const base = [
      message({ id: 'm-0', role: 'user' }),
      message({ id: 'm-1', role: 'assistant' }),
      notice('sys-1', 'm-1'), // anchored to the tail → it trails the tail in the projection
    ]
    project(base)

    const updatedTail = message({ id: 'm-1', role: 'assistant', content: 'delta' })
    const projected = project([base[0]!, updatedTail, base[2]!])

    // Reusing the projection here would have dropped the notice; the guard must refuse.
    expect(metrics.at(-1)?.mode).toBe('full')
    expect(projected.map((m) => m.id)).toEqual(['m-0', 'm-1', 'sys-1'])
  })
})

test('queued answer transport prose never appears as a human message in a transcript surface', () => {
  const project = createTranscriptProjectionSelector()
  const messages = [
    message({ id: 'ask', role: 'user', content: 'Sort the desktop' }),
    message({
      id: 'answer-wake',
      role: 'user',
      isInternal: true,
      wakeSource: 'answer',
      content:
        '[Answer to q-1] The user answered the question you queued earlier: - desktop_access',
    }),
    message({ id: 'reply', role: 'assistant', content: '**Permission received.**' }),
  ]
  expect(project(messages).map((item) => item.id)).toEqual(['ask', 'reply'])
  const updated = [
    ...messages.slice(0, 2),
    { ...messages[2]!, content: '**Permission received.** Working…' },
  ]
  expect(project(updated).map((item) => item.id)).toEqual(['ask', 'reply'])
})
