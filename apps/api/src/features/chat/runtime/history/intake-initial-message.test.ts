/**
 * hooks.md, SessionStart `initialUserMessage`: in a run nobody is typing into, it is the session's
 * first user message, and the run's own prompt follows it as the next turn.
 */
import { expect, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import { intakeTurn } from './intake'
import { USER_PARTICIPANT } from '../../../../db'

const message = (id: string, content: string): PersistedMessage => ({
  id,
  sessionId: 'session-1',
  userId: 'user-1',
  payload: { id, role: 'user', from: USER_PARTICIPANT, content },
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
})

test('initialUserMessage reaches the model before the run’s prompt', async () => {
  const result = await intakeTurn({
    deps: {} as never,
    userId: 'user-1',
    session: { id: 'session-1' } as never,
    assistantMessageId: 'assistant-1',
    assistantCreatedAt: '2026-07-28T00:00:00.000Z',
    historyMessages: [message('wake', 'Nightly check')],
    loadedPlugins: {} as never,
    loadedMiniApps: { hooks: [] } as never,
    ccHooks: { active: false } as never,
    ccSessionStartContext: undefined,
    ccInitialUserMessage: 'Triage the open issues',
    runtimeSections: [],
    defaultCwd: '/repo',
    now: () => '2026-07-28T00:00:00.000Z',
  })
  if (!result.ok) throw new Error('blocked')
  expect(result.frame.messages.map((m) => m.payload.content)).toEqual([
    'Triage the open issues',
    'Nightly check',
  ])
})
