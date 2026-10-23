import { describe, expect, test } from 'bun:test'

import { elapsed } from './agent-wait'
import { OTHER_OPPONENT, opponentName } from './opponent'

describe('the opponent in the person’s words', () => {
  test('names who plays the other side; an unsettled table is the agent’s', () => {
    expect(opponentName({ opponent: 'decision' })).toBe('The decision model')
    expect(opponentName({ opponent: 'agent' })).toBe('The agent')
    expect(opponentName({ opponent: null })).toBe('The agent')
  })

  test('a stuck table offers the other opponent', () => {
    expect(OTHER_OPPONENT.agent).toEqual({ opponent: 'decision', label: 'Use the decision model' })
    expect(OTHER_OPPONENT.decision).toEqual({ opponent: 'agent', label: 'Use the chat agent' })
  })
})

test('a wait reads in seconds, then minutes with padded seconds, never below zero', () => {
  expect(elapsed(-500)).toBe('0s')
  expect(elapsed(12_900)).toBe('12s')
  expect(elapsed(65_000)).toBe('1m 05s')
  expect(elapsed(600_000)).toBe('10m 00s')
})
