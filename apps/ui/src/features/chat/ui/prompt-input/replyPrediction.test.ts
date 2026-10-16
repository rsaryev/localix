import { describe, expect, test } from 'bun:test'
import type { Message, UiSession } from '@/shared/api/contracts'
import {
  REPLY_PREDICTION_DELAY_MS,
  REPLY_PREDICTION_FRESH_MS,
  isFreshReplySubject,
  replyPredictionDelayMs,
  replyPredictionSubject,
} from './replyPrediction'

const msg = (overrides: Partial<Message>): Message => ({
  id: 'm',
  role: 'assistant',
  content: 'Want to go through concrete exercises?',
  ...overrides,
})

const session = (
  messages: Message[],
  extra: Partial<Pick<UiSession, 'queuedMessages' | 'pendingInteraction'>> = {},
) => ({
  messages,
  queuedMessages: [],
  pendingInteraction: null,
  ...extra,
})

describe('what an empty composer predicts a reply to', () => {
  test("the agent's last message, past rows the person does not see", () => {
    const subject = replyPredictionSubject(
      session([
        msg({ id: 'u1', role: 'user', content: 'Explain it' }),
        msg({ id: 'a1' }),
        msg({ id: 'wake', role: 'user', isInternal: true, content: '[loop]' }),
        msg({ id: 'divider', role: 'system', uiOnly: true }),
      ]),
    )
    expect(subject?.id).toBe('a1')
  })

  test("nothing after the person's own line, a system notice, or a tool-only row", () => {
    expect(replyPredictionSubject(session([msg({}), msg({ id: 'u', role: 'user' })]))).toBeNull()
    expect(
      replyPredictionSubject(
        session([msg({}), msg({ id: 'n', role: 'system', content: 'Failed' })]),
      ),
    ).toBeNull()
    expect(
      replyPredictionSubject(
        session([msg({ content: '', items: [{ type: 'tool_call' } as never] })]),
      ),
    ).toBeNull()
  })

  test('a reply that lives only in its text items still counts', () => {
    const subject = replyPredictionSubject(
      session([msg({ content: '', items: [{ type: 'text', text: 'Shall I?' } as never] })]),
    )
    expect(subject).not.toBeNull()
  })

  test('quiet while something else is the person’s to answer', () => {
    const base = [msg({})]
    expect(replyPredictionSubject(session(base, { queuedMessages: [{}] as never }))).toBeNull()
    expect(replyPredictionSubject(session(base, { pendingInteraction: {} as never }))).toBeNull()
  })
})

describe('when it is worth a call', () => {
  const now = Date.parse('2026-10-03T12:00:00.000Z')

  test('a reply watched live is fresh however long it took to write', () => {
    const old = { id: 'a1', createdAt: '2026-10-03T10:00:00.000Z' }
    expect(isFreshReplySubject(old, new Set(['a1']), now)).toBe(true)
  })

  test('one only read later is fresh while recent, and reading an old chat costs nothing', () => {
    const recent = new Date(now - REPLY_PREDICTION_FRESH_MS + 1000).toISOString()
    const stale = new Date(now - REPLY_PREDICTION_FRESH_MS - 1000).toISOString()
    expect(isFreshReplySubject({ id: 'a', createdAt: recent }, new Set(), now)).toBe(true)
    expect(isFreshReplySubject({ id: 'a', createdAt: stale }, new Set(), now)).toBe(false)
    expect(isFreshReplySubject({ id: 'a' }, new Set(), now)).toBe(false)
  })

  test('the pause counts from when the reply settled, and never goes negative', () => {
    expect(replyPredictionDelayMs(now, now)).toBe(REPLY_PREDICTION_DELAY_MS)
    expect(replyPredictionDelayMs(now - 1000, now)).toBe(REPLY_PREDICTION_DELAY_MS - 1000)
    expect(replyPredictionDelayMs(now - 60_000, now)).toBe(0)
  })
})
