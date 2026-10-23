import { describe, expect, test } from 'bun:test'
import type { CallClass } from '@localixai/agent/agents'
import { classifyByAction, UNKNOWN_CALL_CLASS, widestCallClass } from './call-class'

const classify = classifyByAction({
  list: { effect: 'read' },
  move: { effect: 'session' },
  delete: { effect: 'session', irreversible: true },
})

describe('classifyByAction', () => {
  const rows: Array<[string, unknown, CallClass]> = [
    ['a read action', { action: 'list' }, { effect: 'read' }],
    ['a session action', { action: 'move' }, { effect: 'session' }],
    ['an irreversible action', { action: 'delete' }, { effect: 'session', irreversible: true }],
    ['a batch of reads', { actions: [{ action: 'list' }, { action: 'list' }] }, { effect: 'read' }],
    // The batch answers its widest step, not its first.
    [
      'a delete behind a read',
      { actions: [{ action: 'list' }, { action: 'delete' }] },
      { effect: 'session', irreversible: true },
    ],
    [
      'both forms at once',
      { action: 'list', actions: [{ action: 'move' }] },
      { effect: 'session' },
    ],
    ['an unknown action', { action: 'drop' }, UNKNOWN_CALL_CLASS],
    ['an unknown step in a batch', { actions: [{ action: 'list' }, {}] }, UNKNOWN_CALL_CLASS],
    ['an inherited key', { action: 'toString' }, UNKNOWN_CALL_CLASS],
    ['an empty batch', { actions: [] }, UNKNOWN_CALL_CLASS],
    ['a non-array batch', { actions: 'list' }, UNKNOWN_CALL_CLASS],
    ['no action at all', {}, UNKNOWN_CALL_CLASS],
    ['no input', undefined, UNKNOWN_CALL_CLASS],
  ]
  test.each(rows)('%s', (_label, input, expected) => {
    expect(classify(input)).toEqual(expected)
  })
})

describe('widestCallClass', () => {
  test('keeps the widest effect and every flag', () => {
    expect(
      widestCallClass([
        { effect: 'read', needsHuman: true },
        { effect: 'host' },
        { effect: 'files', irreversible: true },
      ]),
    ).toEqual({ effect: 'host', irreversible: true, needsHuman: true })
  })

  test('an empty list proves nothing', () => {
    expect(widestCallClass([])).toEqual(UNKNOWN_CALL_CLASS)
  })
})
