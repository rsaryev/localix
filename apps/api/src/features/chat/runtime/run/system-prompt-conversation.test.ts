import { expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import { conversationPromptContext } from './system-prompt-conversation'

test('a chat run is surrounded by a conversation; a delegated child is not', () => {
  const chat = sessionFixture()
  expect(conversationPromptContext(runPolicyFixture(chat))).toBe(true)
  const child = sessionFixture({ sessionKind: 'subagent' })
  expect(conversationPromptContext(runPolicyFixture(child))).toBe(false)
})
