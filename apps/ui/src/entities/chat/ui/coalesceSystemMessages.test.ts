import { describe, expect, test } from 'bun:test'
import type { Message, SystemNotice } from '../model/types'
import { coalesceSystemMessages } from './coalesceSystemMessages'

const notice = (id: string, text = 'A', over: Partial<SystemNotice> = {}): Message => ({
  id,
  role: 'system',
  systemNotice: { kind: 'hook_notice', tone: 'neutral', text, ...over },
})
const shape = (messages: readonly Message[]) =>
  coalesceSystemMessages(messages).map((message) => [
    message.systemNotice?.text ?? message.content ?? message.commandOutput?.text,
    message.systemRepeatCount ?? 1,
  ])

describe('consecutive system message deduplication', () => {
  test('ignores dates and ids, preserves sequence, and leaves source records untouched', () => {
    const messages = [
      { ...notice('a1'), createdAt: '2020-01-01T00:00:00Z' },
      { ...notice('a2'), createdAt: '2030-01-01T00:00:00Z' },
      notice('b', 'B'),
      notice('a3'),
    ]
    const original = JSON.stringify(messages)
    expect(shape(messages)).toEqual([
      ['A', 2],
      ['B', 1],
      ['A', 1],
    ])
    expect(coalesceSystemMessages(messages)[0]?.id).toBe('a1')
    expect(JSON.stringify(messages)).toBe(original)
  })

  test('conversation messages break a sequence even when their text is the same', () => {
    expect(shape([notice('a1'), { id: 'user', role: 'user', content: 'A' }, notice('a2')])).toEqual(
      [
        ['A', 1],
        ['A', 1],
        ['A', 1],
      ],
    )
  })

  test('applies to every notice kind and tone, including notices with recovery actions', () => {
    const kinds: SystemNotice['kind'][] = [
      'terminal_activity',
      'hook_notice',
      'model_change',
      'run_failed',
      'plan_approved',
    ]
    for (const kind of kinds) {
      for (const tone of ['neutral', 'info', 'success', 'warning', 'error'] as const) {
        expect(
          shape([
            notice('first', 'A', { kind, tone, recovery: ['retry'] }),
            notice('second', 'A', { kind, tone, recovery: ['retry'] }),
          ]),
        ).toEqual([['A', 2]])
      }
    }
  })

  test('different statuses, actions, modes and authors remain separate', () => {
    const first = notice('first')
    const different = [
      notice('tone', 'A', { tone: 'warning' }),
      notice('kind', 'A', { kind: 'terminal_activity' }),
      notice('action', 'A', { recovery: ['retry'] }),
      notice('mode', 'A', { mode: 'autonomous' }),
      { ...notice('author'), from: 'agent:other' },
    ]
    for (const other of different) expect(coalesceSystemMessages([first, other])).toHaveLength(2)
  })

  test('retains unique details and sums producer counts', () => {
    const first = { ...notice('first', 'A', { detail: 'one' }), systemRepeatCount: 3 }
    const second = { ...notice('second', 'A', { detail: 'one\ntwo' }), systemRepeatCount: 2 }
    expect(coalesceSystemMessages([first, second])[0]).toMatchObject({
      id: 'first',
      systemRepeatCount: 5,
      systemNotice: { text: 'A', detail: 'one\ntwo' },
    })
  })

  test('handles plain system messages, dividers and command outputs', () => {
    const plain: Message = { id: 'plain', role: 'system', content: 'A' }
    const command: Message = {
      id: 'command',
      role: 'system',
      commandOutput: { command: 'help', tone: 'neutral', text: 'B' },
    }
    expect(shape([plain, { ...plain, id: 'p2' }, command, { ...command, id: 'c2' }])).toEqual([
      ['A', 2],
      ['B', 2],
    ])
    expect(
      shape([
        { ...plain, uiOnly: true },
        { ...plain, uiOnly: true, id: 'divider' },
      ]),
    ).toEqual([['A', 2]])
  })

  test('object property insertion order does not change equivalence', () => {
    const first: Message = {
      id: 'first',
      role: 'system',
      commandOutput: { command: 'help', tone: 'neutral', text: 'A' },
    }
    const second: Message = {
      id: 'second',
      role: 'system',
      commandOutput: { text: 'A', tone: 'neutral', command: 'help' },
    }
    expect(shape([first, second])).toEqual([['A', 2]])
  })
})
