/// <reference types="bun" />

import { describe, test, expect } from 'bun:test'
import { buildTurnBudgetReminder, reminderSections } from './reminders'

/**
 * The reminders ride the turn's runtime context as keyed `state` sections: sent when they
 * change and left where they were sent. As a message rebuilt every turn they rewrote history
 * the model had already seen, which broke the prefix cache and preserved thinking.
 */
describe('reminderSections', () => {
  test('keys the turn budget as a state section, and says nothing without one', () => {
    const sections = reminderSections({ maxTurns: 5 })
    expect(sections.map(({ key, scope }) => ({ key, scope }))).toEqual([
      { key: 'turn-budget', scope: 'state' },
    ])
    expect(reminderSections({})).toEqual([])
  })

  test('the same facts render the same bytes, so an unchanged state sends no delta', () => {
    expect(reminderSections({ maxTurns: 3 })).toEqual(reminderSections({ maxTurns: 3 }))
  })
})

describe('buildTurnBudgetReminder — the agent is told what it may spend', () => {
  test('a low cap is stated, so the agent can front-load instead of being cut off', () => {
    // Observed: a run capped at a few turns opened a long investigation and was cut off before
    // it said anything, because nothing had told it the run was short.
    const reminder = buildTurnBudgetReminder(5)!
    expect(reminder).toContain('<system-reminder>')
    expect(reminder).toContain('5 agentic turns')
  })

  test('one turn reads as one turn', () => {
    expect(buildTurnBudgetReminder(1)).toContain('1 agentic turn ')
  })

  test('a cap the agent cannot plan against is not mentioned at all', () => {
    // "You have a thousand turns" costs tokens to say and changes no decision, and a reminder
    // that is always present is one the model stops reading.
    expect(buildTurnBudgetReminder(1000)).toBeNull()
    expect(buildTurnBudgetReminder(undefined)).toBeNull()
  })
})
