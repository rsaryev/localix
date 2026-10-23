import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyTicTacToeCall } from './tools'

const rows: Array<[string, unknown, CallClass]> = [
  ['state', { action: 'state' }, { effect: 'read' }],
  ['move', { action: 'move', cell: 4 }, { effect: 'session' }],
  ['new_game', { action: 'new_game' }, { effect: 'session' }],
  ['a batch of reads', { actions: [{ action: 'state' }] }, { effect: 'read' }],
  [
    'a batch ending in a move',
    { actions: [{ action: 'state' }, { action: 'move' }] },
    { effect: 'session' },
  ],
  // tic-tac-toe has no resign: an action from another game is unknown here.
  ['resign', { action: 'resign' }, { effect: 'external' }],
  ['no action', {}, { effect: 'external' }],
]

test.each(rows)('tic_tac_toe %s', (_label, input, expected) => {
  expect(classifyTicTacToeCall(input)).toEqual(expected)
})
