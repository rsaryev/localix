import { describe, expect, test } from 'bun:test'
import { createSyntheticMessages } from './synthetic-messages'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'

function harness() {
  const inserted: PersistedMessage[] = []
  const events: Array<{ type: string; message?: PersistedMessage; messageId?: string }> = []
  let updatedSession: SessionRecord | null = null
  let publishedSession: SessionRecord | null = null
  const repo = {
    insertMessage: async (m: PersistedMessage) => {
      inserted.push(m)
    },
    updateSession: async (_u: string, _s: string, sess: SessionRecord) => {
      updatedSession = sess
    },
  }
  const streamRegistry = {
    publish: (_u: string, _s: string, e: { type: string }) => {
      events.push(e as never)
    },
  }
  const svc = createSyntheticMessages({
    repo: repo as never,
    streamRegistry: streamRegistry as never,
    publishSession: (s) => {
      publishedSession = s
    },
  })
  return {
    svc,
    inserted,
    events,
    get updatedSession() {
      return updatedSession
    },
    get publishedSession() {
      return publishedSession
    },
  }
}

describe('insertAssistantReply', () => {
  test('persists an assistant message and emits run.started → message.created → run.completed', async () => {
    const h = harness()
    const id = await h.svc.insertAssistantReply('u', 's', 'hello world', '2026-01-01')

    expect(h.inserted).toHaveLength(1)
    expect(h.inserted[0].payload).toMatchObject({ role: 'assistant', content: 'hello world' })
    expect(h.events.map((e) => e.type)).toEqual(['run.started', 'message.created', 'run.completed'])
    // the emitted ids all match the returned message id
    expect(id).toBe(h.inserted[0].id)
    expect(h.events[1].message?.id).toBe(id)
    expect(h.events[2].messageId).toBe(id)
    // `run.completed` is replayable, so it must carry WHEN the run ended: without it a client that
    // reconnects hours later has only `Date.now()` to date the notification by, and the TTL cannot
    // stop an ancient completion from raising a native banner. A real clock reading, not merely
    // present — a hard-coded or zero value would silently restore that.
    const finishedAt = (h.events[2] as { finishedAt?: number }).finishedAt
    expect(typeof finishedAt).toBe('number')
    expect(finishedAt!).toBeGreaterThan(0)
    expect(finishedAt!).toBeLessThanOrEqual(Date.now())
  })

  test('marks its run.completed synthetic, so clients do not report a slash command as a run', async () => {
    // Without the mark every `/usage` or `/model` added "Agent run finished" to the Event Center.
    const reply = harness()
    await reply.svc.insertDirectReply('u', 's', '/usage', 'Usage: 1k tokens', '2026-01-02')
    const notice = harness()
    await notice.svc.insertSystemNotice(
      'u',
      's',
      { kind: 'model_change', tone: 'neutral', text: 'Model changed to sonnet' },
      '2026-01-02',
      true,
    )
    for (const events of [reply.events, notice.events]) {
      expect(events.find((event) => event.type === 'run.completed')).toMatchObject({
        synthetic: true,
      })
    }
  })
})

describe('insertDirectReply', () => {
  test('inserts one model-invisible command result instead of a fake chat turn', async () => {
    const h = harness()
    const res = await h.svc.insertDirectReply('u', 's', 'what is 2+2?', '4', '2026-01-02')

    expect(h.inserted).toHaveLength(1)
    expect(h.inserted[0].payload).toMatchObject({
      role: 'assistant',
      content: '4',
      uiOnly: true,
      commandOutput: { command: '/', tone: 'neutral' },
    })
    expect(h.updatedSession).toBeNull()
    expect(h.publishedSession).toBeNull()
    expect(res.messageId).toBe(h.inserted[0].id)
  })

  test('derives lifecycle tones from plain system text instead of emoji prefixes', async () => {
    const success = harness()
    const failure = harness()

    await success.svc.insertDirectReply(
      'u',
      's',
      '/plugin install review',
      'Installed `review` v1.0.0.',
      '2026-01-02',
    )
    await failure.svc.insertDirectReply(
      'u',
      's',
      '/plugin install review',
      'Install failed: manifest missing',
      '2026-01-02',
    )

    expect(success.inserted[0].payload.commandOutput?.tone).toBe('success')
    expect(failure.inserted[0].payload.commandOutput?.tone).toBe('error')
  })
})

describe('insertSystemNotice', () => {
  test('persists one structured row the room reads, and settles an optimistic send', async () => {
    const h = harness()
    const result = await h.svc.insertSystemNotice(
      'u',
      's',
      { kind: 'model_change', tone: 'neutral', text: 'Model changed to sonnet' },
      '2026-01-02',
      true,
    )

    expect(h.inserted).toHaveLength(1)
    expect(h.inserted[0].payload).toMatchObject({
      role: 'user',
      content: 'Model changed to sonnet',
      systemNotice: { kind: 'model_change', text: 'Model changed to sonnet' },
    })
    // The prose is UI-only. The room receives its meaning through the canonical context-binding
    // path, where repeated model changes can be reduced before the volatile tail is built.
    expect(h.inserted[0].payload.uiOnly).toBe(true)
    expect(h.inserted[0].payload.bindings?.[0]).toMatchObject({
      kind: 'context',
      source: 'system',
      target: { kind: 'system-event', token: 'notice:model_change' },
    })
    expect(h.events.map((event) => event.type)).toEqual([
      'run.started',
      'message.created',
      'run.completed',
    ])
    expect(result.messageId).toBe(h.inserted[0].id)
  })
})

describe('insertContextBoundary', () => {
  test('writes a hidden boundary and a model-invisible command result', async () => {
    const h = harness()
    const session = { title: 'T', id: 's' } as unknown as SessionRecord
    await h.svc.insertContextBoundary('u', 's', session, '/clear', 'Context cleared.', '2026-01-03')

    // No cast: `toMatchObject` reads the payload as-is (the sibling assertion below always did).
    // `StoredMessagePayload` is an interface, so widening it to `Record<string, unknown>` was
    // never a legal conversion anyway.
    expect(h.inserted[0].payload).toMatchObject({
      role: 'user',
      content: '/clear',
      isInternal: true,
      contextBoundary: true,
    })
    expect(h.inserted[1].payload).toMatchObject({
      role: 'assistant',
      content: 'Context cleared.',
      uiOnly: true,
      commandOutput: { command: '/clear', tone: 'success' },
    })
  })

  // A cleared view starts empty, so an open transcript must drop its checkpoint divider now,
  // not on its next reload.
  test('tells open transcripts the checkpoint divider no longer holds', async () => {
    const h = harness()
    const session = { title: 'T', id: 's' } as unknown as SessionRecord
    await h.svc.insertContextBoundary('u', 's', session, '/clear', 'Cleared.', '2026-01-04')
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: 'session_model_view.updated',
        sessionId: 's',
        modelView: null,
      }),
    )
  })
})
