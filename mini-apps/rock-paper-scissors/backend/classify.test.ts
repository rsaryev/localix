import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyRockPaperScissorsCall } from './tools'

const rows: Array<[string, unknown, CallClass]> = [
  ['state', { action: 'state' }, { effect: 'read' }],
  ['play', { action: 'play', move: 'rock' }, { effect: 'session' }],
  ['next_round', { action: 'next_round' }, { effect: 'session' }],
  ['an action from another game', { action: 'move' }, { effect: 'external' }],
  ['no action', {}, { effect: 'external' }],
]

test.each(rows)('rock_paper_scissors %s', (_label, input, expected) => {
  expect(classifyRockPaperScissorsCall(input)).toEqual(expected)
})
