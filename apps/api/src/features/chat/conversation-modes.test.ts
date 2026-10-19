import { describe, expect, test } from 'bun:test'

import {
  bornConversationMode,
  CONVERSATION_MODE_NOTICE,
  parseConversationMode,
} from './conversation-modes'

describe('conversation modes', () => {
  test('a new chat with one agent is solo; one born with several is the group it already is', () => {
    expect(bornConversationMode(1)).toBe('solo')
    expect(bornConversationMode(3)).toBe('group')
  })

  test('an unrecognised stored value is a group, never a quietly narrower solo', () => {
    expect(parseConversationMode('solo')).toBe('solo')
    expect(parseConversationMode('team')).toBe('group')
    expect(parseConversationMode(undefined)).toBe('group')
  })

  test('the change line names agents without @, so no one is handed a turn by it', () => {
    for (const text of Object.values(CONVERSATION_MODE_NOTICE)) expect(text).not.toContain('@')
  })
})
