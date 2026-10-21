import { describe, expect, test } from 'bun:test'
import type { Message } from '@/shared/api/contracts'
import { createTranscriptProjectionSelector } from '../ui/transcriptProjection'
import { deriveWakeProvenance } from '@localixai/api/wake-provenance'
import { messageDisplayRows, messagePositions } from './messageGroups'

const DAY = '2026-09-11T'

function msg(id: string, from: string, clock?: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    role: from === 'user' ? 'user' : 'assistant',
    from,
    content: id,
    ...(clock ? { createdAt: `${DAY}${clock}:00` } : {}),
    ...extra,
  } as Message
}

const shape = (messages: Message[]) =>
  messagePositions(messages).map(
    (p) => `${p.isFirstInGroup ? 'F' : '-'}${p.isLastInGroup ? 'L' : '-'}`,
  )

describe('messagePositions', () => {
  test('separate assistant executions retain their own author headers', () => {
    // The whole point: the header is printed once, not on every card.
    expect(
      shape([
        msg('a', 'agent:localix', '10:00'),
        msg('b', 'agent:localix', '10:01'),
        msg('c', 'agent:localix', '10:02'),
      ]),
    ).toEqual(['FL', 'FL', 'FL'])
  })

  test('an explicitly linked mid-run report continues the same visible response', () => {
    const transcript = [
      msg('before', 'agent:localix', '10:00'),
      msg('report', 'user', '10:01', { isInternal: true, wakeSource: 'subagent' }),
      msg('after', 'agent:localix', '10:01', { continuedFromMessageId: 'before' }),
    ]
    const visible = createTranscriptProjectionSelector()(transcript)
    expect(visible.map((message) => message.id)).toEqual(['before', 'after'])
    expect(messagePositions(visible).map((p) => [p.isFirstInGroup, p.isLastInGroup])).toEqual([
      [true, false],
      [false, true],
    ])
    expect(deriveWakeProvenance(transcript).get('after')).toBe('subagent')
  })

  test('a separate wake or a different speaker never joins the preceding response', () => {
    expect(
      shape([
        msg('before', 'agent:localix', '10:00'),
        msg('wake', 'agent:localix', '10:01', { wakeSource: 'subagent' }),
        msg('other', 'agent:reviewer', '10:02', { continuedFromMessageId: 'wake' }),
      ]),
    ).toEqual(['FL', 'FL', 'FL'])
  })

  test('a change of speaker starts a new group', () => {
    expect(
      shape([
        msg('a', 'user', '10:00'),
        msg('b', 'agent:localix', '10:01'),
        msg('c', 'agent:reviewer', '10:02'),
      ]),
    ).toEqual(['FL', 'FL', 'FL'])
  })

  test('a long pause splits one speaker in two', () => {
    // Below the gap the run is one turn of a conversation; above it the reader has been away
    // and wants telling who is speaking again.
    expect(
      shape([
        msg('a', 'agent:localix', '10:00'),
        msg('b', 'agent:localix', '10:09'),
        msg('c', 'agent:localix', '10:30'),
      ]),
    ).toEqual(['FL', 'FL', 'FL'])
  })

  test('a notice is punctuation and breaks the run on both sides', () => {
    const rows = [
      msg('a', 'agent:localix', '10:00'),
      { ...msg('n', 'system', '10:01'), role: 'system' } as Message,
      msg('b', 'agent:localix', '10:02'),
    ]
    expect(shape(rows)).toEqual(['FL', 'FL', 'FL'])
  })

  test('a ui-only divider breaks it too', () => {
    const rows = [
      msg('a', 'agent:localix', '10:00'),
      msg('d', 'agent:localix', '10:01', { uiOnly: true }),
      msg('b', 'agent:localix', '10:02'),
    ]
    expect(shape(rows)).toEqual(['FL', 'FL', 'FL'])
  })

  test('an un-timestamped optimistic row does not split its own run', () => {
    // It has not round-tripped yet. Splitting on that would put a header on the message you
    // just sent and take it away again a moment later.
    expect(shape([msg('a', 'user', '10:00'), msg('b', 'user')])).toEqual(['F-', '-L'])
  })

  test('a day boundary always splits, whatever the gap', () => {
    const rows = [
      { ...msg('a', 'agent:localix'), createdAt: '2026-09-10T23:58:00' } as Message,
      { ...msg('b', 'agent:localix'), createdAt: '2026-09-11T00:01:00' } as Message,
    ]
    expect(shape(rows)).toEqual(['FL', 'FL'])
  })

  test('the first message of each day carries the divider', () => {
    const rows = [
      { ...msg('a', 'user'), createdAt: '2026-09-10T09:00:00' } as Message,
      { ...msg('b', 'user'), createdAt: '2026-09-10T09:01:00' } as Message,
      { ...msg('c', 'user'), createdAt: '2026-09-11T09:00:00' } as Message,
    ]
    const days = messagePositions(rows).map((p) => p.dayStart?.getDate())
    expect(days).toEqual([10, undefined, 11])
  })

  test('a row with no timestamp opens no day', () => {
    expect(messagePositions([msg('a', 'user')])[0]?.dayStart).toBeUndefined()
  })

  test('a lone message is both ends of its own group', () => {
    expect(shape([msg('a', 'user', '10:00')])).toEqual(['FL'])
  })

  test('an empty transcript has no positions', () => {
    expect(messagePositions([])).toEqual([])
  })
})

describe('messageDisplayRows', () => {
  test('joins only explicit adjacent visible continuation segments without altering the model', () => {
    const transcript = [
      msg('a', 'agent:localix', '10:00'),
      msg('hidden', 'user', '10:01', { isInternal: true, wakeSource: 'plugin' }),
      msg('b', 'agent:localix', '10:02', { continuedFromMessageId: 'a' }),
      msg('c', 'agent:localix', '10:03', { continuedFromMessageId: 'b' }),
      msg('independent', 'agent:localix', '10:04', { wakeSource: 'plugin' }),
    ]
    const visible = createTranscriptProjectionSelector()(transcript)
    const rows = messageDisplayRows(visible)
    expect(rows.map((row) => row.segments.map((segment) => segment.id))).toEqual([
      ['a', 'b', 'c'],
      ['independent'],
    ])
    expect(rows.map((row) => row.firstIndex)).toEqual([0, 3])
    expect(transcript.map((message) => message.id)).toEqual([
      'a',
      'hidden',
      'b',
      'c',
      'independent',
    ])
    expect(rows[0]?.segments[1]).toBe(transcript[2])
  })

  test('a visible notice, broken link, or another speaker keeps separate cards', () => {
    const notice = { ...msg('notice', 'system'), role: 'system' } as Message
    const rows = messageDisplayRows([
      msg('a', 'agent:localix'),
      notice,
      msg('b', 'agent:localix', undefined, { continuedFromMessageId: 'a' }),
      msg('c', 'agent:other', undefined, { continuedFromMessageId: 'b' }),
      msg('d', 'agent:localix', undefined, { continuedFromMessageId: 'missing' }),
    ])
    expect(rows.map((row) => row.segments.map((segment) => segment.id))).toEqual([
      ['a'],
      ['notice'],
      ['b'],
      ['c'],
      ['d'],
    ])
  })
})
