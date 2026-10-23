import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyGame2048Call } from './tools'

const rows: Array<[string, unknown, CallClass]> = [
  ['state', { action: 'state' }, { effect: 'read' }],
  ['move', { action: 'move', moves: ['down', 'left'] }, { effect: 'session' }],
  ['new_game', { action: 'new_game', mode: 'agent' }, { effect: 'session' }],
  ['unknown action', { action: 'undo' }, { effect: 'external' }],
  ['no action', {}, { effect: 'external' }],
]

test.each(rows)('game_2048 %s', (_label, input, expected) => {
  expect(classifyGame2048Call(input)).toEqual(expected)
})
