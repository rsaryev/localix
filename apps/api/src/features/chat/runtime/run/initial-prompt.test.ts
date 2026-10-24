import { expect, test } from 'bun:test'
import type { PersistedMessage } from '../../contracts'
import { initialPromptSection } from './initial-prompt'

// sub-agents.md, `initialPrompt`: "Auto-submitted as the first user turn when this agent runs as the
// main session agent … Prepended to any user-provided prompt."
const user = (content: string, isInternal = false): PersistedMessage =>
  ({
    id: content,
    sessionId: 's',
    userId: 'u',
    payload: { id: content, role: 'user', content, isInternal },
  }) as never

test('the main agent’s initial prompt leads the chat’s first turn only', () => {
  const agent = { initialPrompt: 'Read the open issues first.' }
  const first = initialPromptSection(agent, [user('Fix the build')])
  expect(first?.scope).toBe('turn')
  expect(first?.text).toContain('Read the open issues first.')
  expect(initialPromptSection(agent, [user('Fix the build'), user('And the tests')])).toBeNull()
  expect(initialPromptSection({}, [user('Fix the build')])).toBeNull()
  expect(initialPromptSection(null, [user('Fix the build')])).toBeNull()
})
