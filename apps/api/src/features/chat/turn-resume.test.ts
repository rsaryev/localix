import { describe, expect, test } from 'bun:test'

import type { StoredSystemNotice } from '../../db/payload'
import type { PersistedMessage } from './contracts'
import {
  TURN_RESUME_KEY,
  continueInstruction,
  turnDetail,
  turnResumeProducer,
  unfinishedTurn,
} from './turn-resume'

/**
 * A reply that did not finish is continued, not regenerated: the point holds while its ending is
 * the conversation's last word, and the agent alone reads what happened.
 */
let seq = 0
const row = (payload: Record<string, unknown>): PersistedMessage =>
  ({
    id: `m${++seq}`,
    sessionId: 'S1',
    payload: { v: 1, ...payload },
    createdAt: '2026-10-21T00:00:00.000Z',
  }) as unknown as PersistedMessage

const user = (content: string, extra: Record<string, unknown> = {}) =>
  row({ role: 'user', content, ...extra })
const reply = (items: unknown[] = []) => row({ role: 'assistant', content: '', items })
const notice = (systemNotice: StoredSystemNotice) =>
  row({ role: 'user', uiOnly: true, content: systemNotice.text, systemNotice })

const interrupted: StoredSystemNotice = {
  kind: 'run_interrupted',
  tone: 'warning',
  text: 'Backend restarted while bash was still running — this reply is incomplete.',
  recovery: ['retry'],
}
const runningBash = [{ type: 'tool_call', name: 'Bash', status: 'running' }]

describe('the unfinished turn', () => {
  test('is the ending that is still the last word, with the reply it ended', () => {
    const ended = reply(runningBash)
    const turn = unfinishedTurn([
      user('deploy it'),
      ended,
      notice(interrupted),
      notice({ kind: 'model_change', tone: 'neutral', text: 'localix is now on gpt' }),
    ])
    expect(turn?.notice.kind).toBe('run_interrupted')
    expect(turn?.reply).toBe(ended)
  })

  test('is gone once anything was said or run after it, a hidden wake included', () => {
    expect(unfinishedTurn([user('a'), reply(), notice(interrupted), user('next')])).toBeNull()
    expect(
      unfinishedTurn([reply(), notice(interrupted), user('woken', { isInternal: true })]),
    ).toBeNull()
    expect(unfinishedTurn([reply(), notice(interrupted), reply()])).toBeNull()
  })

  test('is not offered where trying again cannot help', () => {
    const spent: StoredSystemNotice = {
      kind: 'run_failed',
      tone: 'error',
      text: 'The daily limit of this key is spent.',
      recovery: ['open-settings:providers'],
    }
    expect(unfinishedTurn([user('a'), reply(), notice(spent)])).toBeNull()
  })
})

describe('what continuing says', () => {
  test('to the agent: what happened, the calls whose effect is unknown, and to carry on', () => {
    const text = continueInstruction({ notice: interrupted, reply: reply(runningBash) })
    expect(text).toContain('server restarted')
    expect(text).toContain('may or may not have taken effect: Bash')
    expect(text).toContain('Check the current state before repeating')
    expect(text).toContain('without repeating completed work')
  })

  test('to the person: one short line', () => {
    expect(turnDetail({ notice: interrupted, reply: reply(runningBash) })).toBe(
      'The server restarted while Bash was running — check before continuing',
    )
    expect(turnDetail({ notice: interrupted, reply: reply() })).toBe(
      'The server restarted mid-reply',
    )
  })

  test('through the producer: the point, then the hidden note and the visible line', async () => {
    const messages = [user('deploy it'), reply(runningBash), notice(interrupted)]
    const producer = turnResumeProducer({ listMessages: async () => messages })
    const owner = { userId: 'u', sessionId: 'S1' }
    expect(await producer.list(owner)).toEqual([
      {
        key: TURN_RESUME_KEY,
        kind: 'turn',
        title: 'Reply interrupted',
        detail: 'The server restarted while Bash was running — check before continuing',
      },
    ])
    const action = await producer.take(owner, TURN_RESUME_KEY)
    expect(action?.content).toContain('may or may not have taken effect: Bash')
    expect(action?.notice).toMatchObject({
      kind: 'run_continued',
      text: 'Continued after the interruption',
    })
    messages.push(user('something else'))
    expect(await producer.take(owner, TURN_RESUME_KEY)).toBeNull()
  })
})
