import { expect, test } from 'bun:test'
import { selectSessionConnectionId } from './connectionScope'

/** A connection belongs to a participant, so a fixture session states a party of one. */
const on = (id: string, providerConnectionId: string) => ({
  id,
  agents: [
    {
      agentId: 'builtin:localix',
      handle: 'localix',
      providerConnectionId,
      modelId: 'm',
      reasoningEffort: 'low' as const,
    },
  ],
})

const sessions = [on('focused', 'connection-a')]
const allSessions = [...sessions, on('surface', 'connection-b')]

test('scopes connections to the session the surface names', () => {
  expect(selectSessionConnectionId({ sessions, allSessions }, 'focused')).toBe('connection-a')
  expect(selectSessionConnectionId({ sessions, allSessions }, 'surface')).toBe('connection-b')
})

test('a surface that names no chat routes none — never the chat on screen', () => {
  expect(selectSessionConnectionId({ sessions, allSessions }, null)).toBeNull()
})

test('resolves a cross-scope draft before the working list catches up', () => {
  expect(selectSessionConnectionId({ sessions, allSessions }, 'surface')).toBe('connection-b')
  expect(selectSessionConnectionId({ sessions, allSessions }, 'missing')).toBeNull()
})
