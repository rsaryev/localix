import { describe, expect, test } from 'bun:test'

import { sharedPromptCacheKey } from './prompt-cache-key'

const base = {
  userId: 'u1',
  providerConnectionId: 'conn-1',
  modelId: 'gpt-6.1-sol',
  agentId: 'lead',
  workspaceRoot: '/work/project',
}

describe('the prompt cache key of a session', () => {
  test('is the same for two sessions of one agent, model and project', () => {
    expect(sharedPromptCacheKey(base)).toBe(sharedPromptCacheKey({ ...base }))
  })

  test('differs when what the request prefix is made of differs', () => {
    const key = sharedPromptCacheKey(base)
    for (const change of [
      { userId: 'u2' },
      { providerConnectionId: 'conn-2' },
      { modelId: 'gpt-6.1-mini' },
      { agentId: 'qa' },
      { workspaceRoot: '/work/other' },
    ])
      expect(sharedPromptCacheKey({ ...base, ...change })).not.toBe(key)
  })

  test('fits the key OpenAI takes and does not spell out a path or an id', () => {
    const key = sharedPromptCacheKey(base)
    expect(key.length).toBeLessThanOrEqual(64)
    expect(key).not.toContain('/work')
    expect(key).not.toContain('lead')
  })

  test('does not run two fields together', () => {
    expect(sharedPromptCacheKey({ ...base, agentId: 'a', workspaceRoot: 'bc' })).not.toBe(
      sharedPromptCacheKey({ ...base, agentId: 'ab', workspaceRoot: 'c' }),
    )
  })
})
