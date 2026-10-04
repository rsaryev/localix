import { describe, expect, test } from 'bun:test'

import { hasConversationStarted } from './roster-lock'

describe('when a conversation has started', () => {
  test('an empty conversation has not', () => {
    expect(hasConversationStarted([])).toBe(false)
  })

  // Adding a colleague before the first message writes "@qa joined"; counting that line would
  // close the choice the moment the person used the roster it is about.
  test('the lines the product writes itself do not start it', () => {
    expect(hasConversationStarted([{ from: 'system' }, { from: 'system' }])).toBe(false)
  })

  test('the first line somebody authored does', () => {
    expect(hasConversationStarted([{ from: 'system' }, { from: 'user' }])).toBe(true)
    expect(hasConversationStarted([{ from: 'agent:builtin:localix' }])).toBe(true)
  })

  test('a row nobody authored (a client-synthesized wait) does not', () => {
    expect(hasConversationStarted([{}, { from: null }])).toBe(false)
  })
})
