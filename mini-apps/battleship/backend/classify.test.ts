import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyBattleshipCall } from './tools'

const rows: Array<[string, unknown, CallClass]> = [
  ['state', { action: 'state' }, { effect: 'read' }],
  ['fire', { action: 'fire', cell: 'B4' }, { effect: 'session' }],
  ['new_game', { action: 'new_game' }, { effect: 'session' }],
  ['a batch of reads', { actions: [{ action: 'state' }] }, { effect: 'read' }],
  [
    'a batch ending in a shot',
    { actions: [{ action: 'state' }, { action: 'fire' }] },
    { effect: 'session' },
  ],
  ['unknown action', { action: 'move' }, { effect: 'external' }],
  ['no action', {}, { effect: 'external' }],
]

test.each(rows)('battleship %s', (_label, input, expected) => {
  expect(classifyBattleshipCall(input)).toEqual(expected)
})
