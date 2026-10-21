import { describe, expect, test } from 'bun:test'
import { runnableConnectionId, selectSessionConnectionId } from './connectionScope'

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

describe('runnableConnectionId', () => {
  const models = [
    { providerId: 'openrouter', id: 'deepseek/deepseek-v4.1-flash' },
    { providerId: 'openai', id: 'gpt-6-luna' },
  ]
  const DEEPSEEK = 'openrouter/deepseek/deepseek-v4.1-flash'
  const connection = (id: string, providerId: string, hasApiKey = true) => ({
    id,
    providerId,
    hasApiKey,
  })

  test('a chat whose connection was deleted and signed in again can send on the new one', () => {
    // The setup report: the route kept DeepSeek with no connection after the old one was removed.
    expect(
      runnableConnectionId({
        storedId: null,
        modelId: DEEPSEEK,
        connections: [connection('openai-1', 'openai'), connection('or-new', 'openrouter')],
        models,
      }),
    ).toBe('or-new')
  })

  test('the stored connection stays while it still runs the model', () => {
    expect(
      runnableConnectionId({
        storedId: 'or',
        modelId: DEEPSEEK,
        connections: [connection('or', 'openrouter'), connection('or-2', 'openrouter')],
        models,
      }),
    ).toBe('or')
  })

  test('no account of the model provider means no connection, whatever is stored', () => {
    expect(
      runnableConnectionId({
        storedId: 'openai-1',
        modelId: DEEPSEEK,
        connections: [connection('openai-1', 'openai')],
        models,
      }),
    ).toBeNull()
  })

  test('an account without a usable key is not runnable', () => {
    expect(
      runnableConnectionId({
        storedId: 'or',
        modelId: DEEPSEEK,
        connections: [connection('or', 'openrouter', false)],
        models,
      }),
    ).toBeNull()
  })

  test('with no model, or before the catalog loads, the stored id is used as is', () => {
    const connections = [connection('or', 'openrouter')]
    expect(runnableConnectionId({ storedId: 'or', modelId: '', connections, models })).toBe('or')
    expect(
      runnableConnectionId({ storedId: 'or', modelId: 'gpt-6-luna', connections, models: [] }),
    ).toBe('or')
  })
})
