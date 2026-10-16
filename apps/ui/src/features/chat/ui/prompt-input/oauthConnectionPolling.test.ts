import { describe, expect, test } from 'bun:test'

import { findChangedOAuthConnection } from './oauthConnectionPolling'

const connection = (id: string, providerId: string, updatedAt: string, keyCount: number) => ({
  id,
  providerId,
  updatedAt,
  keyCount,
})

describe('OAuth connection polling', () => {
  test('detects an in-place repair of an existing zero-key connection', () => {
    const orphan = connection('openrouter-1', 'openrouter', '2026-07-19T00:00:00.000Z', 0)
    const repaired = connection('openrouter-1', 'openrouter', '2026-07-19T00:01:00.000Z', 1)

    expect(findChangedOAuthConnection([orphan], [repaired], 'openrouter')).toBe(repaired)
  })

  test('detects a newly created connection for the requested provider', () => {
    const existing = connection('anthropic-1', 'anthropic', '2026-07-19T00:00:00.000Z', 1)
    const created = connection('openrouter-1', 'openrouter', '2026-07-19T00:01:00.000Z', 1)

    expect(findChangedOAuthConnection([existing], [existing, created], 'openrouter')).toBe(created)
  })

  test('ignores unchanged and unrelated connections', () => {
    const openrouter = connection('openrouter-1', 'openrouter', '2026-07-19T00:00:00.000Z', 1)
    const unrelated = connection('anthropic-1', 'anthropic', '2026-07-19T00:01:00.000Z', 1)

    expect(
      findChangedOAuthConnection([openrouter], [openrouter, unrelated], 'openrouter'),
    ).toBeUndefined()
  })
})
