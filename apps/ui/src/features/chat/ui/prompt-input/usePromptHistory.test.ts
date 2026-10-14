import { expect, test } from 'bun:test'
import { shallow } from 'zustand/shallow'
import type { UiSession } from '@/shared/api/contracts'
import { selectPromptHistoryMessages } from './usePromptHistory'

const session = (messages: UiSession['messages']): UiSession =>
  ({ id: 'session', messages }) as UiSession

test('ignores assistant-only streaming changes', () => {
  const user = { id: 'u', role: 'user' as const, content: 'prompt' }
  const before = selectPromptHistoryMessages({ sessions: [session([user])] }, 'session')
  const assistant = { id: 'a', role: 'assistant' as const, content: 'stream' }
  const after = selectPromptHistoryMessages({ sessions: [session([user, assistant])] }, 'session')

  expect(before).toEqual([user])
  expect(shallow(before, after)).toBe(true)
})
