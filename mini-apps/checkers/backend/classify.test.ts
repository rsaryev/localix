import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyCheckersCall } from './tools'

const rows: Array<[string, unknown, CallClass]> = [
  ['state', { action: 'state' }, { effect: 'read' }],
  ['move', { action: 'move' }, { effect: 'session' }],
  ['new_game', { action: 'new_game' }, { effect: 'session' }],
  ['resign', { action: 'resign' }, { effect: 'session' }],
  ['a batch of reads', { actions: [{ action: 'state' }] }, { effect: 'read' }],
  [
    'a batch ending in a move',
    { actions: [{ action: 'state' }, { action: 'move' }] },
    { effect: 'session' },
  ],
  ['unknown action', { action: 'flip_board' }, { effect: 'external' }],
  ['no action', {}, { effect: 'external' }],
]

test.each(rows)('checkers %s', (_label, input, expected) => {
  expect(classifyCheckersCall(input)).toEqual(expected)
})
