import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/plugin-sdk/backend'
import { classifySnakeCall } from './tools'

const rows: Array<[string, unknown, CallClass]> = [
  ['state', { action: 'state' }, { effect: 'read' }],
  ['new_game', { action: 'new_game' }, { effect: 'session' }],
  ['unknown action', { action: 'move' }, { effect: 'external' }],
]

test.each(rows)('snake %s', (_label, input, expected) => {
  expect(classifySnakeCall(input)).toEqual(expected)
})
