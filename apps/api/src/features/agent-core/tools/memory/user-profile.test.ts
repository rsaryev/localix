import { describe, expect, test } from 'bun:test'
import { loadUserProfileContext } from './user-profile'
import type { UserProfileRepository, UserProfileRow } from '../../../user/repository'

// In-memory stub of the profile repo — the loaders never touch a database here.
function makeRepo(initial?: Partial<UserProfileRow>) {
  const row: Partial<UserProfileRow> | null = initial ?? null
  const repo = {
    async getRaw() {
      return row as UserProfileRow | null
    },
  }
  return { repo: repo as unknown as UserProfileRepository }
}

describe('user profile context', () => {
  test('runtime reads normalize legacy agent settings before consumers see them', async () => {
    const { repo } = makeRepo({
      agent_settings: JSON.stringify({ contextExclusions: ['**/.env'], retiredFlag: true }),
    })
    expect((await loadUserProfileContext(repo, 'u1')).agentSettings).toEqual({
      contextExclusions: ['**/.env'],
    })

    const invalid = makeRepo({ agent_settings: JSON.stringify({ maxTurns: -1 }) })
    expect((await loadUserProfileContext(invalid.repo, 'u1')).agentSettings).toBeNull()
  })

  test('keeps volatile profile metadata out of the cacheable prompt text', async () => {
    const { repo } = makeRepo({
      name: 'Ada',
      updated_at: '2026-07-24T07:22:45.000Z',
    })

    const context = await loadUserProfileContext(repo, 'u1')

    expect(context.profileText).toContain('Name: Ada')
    expect(context.profileText).not.toContain('2026-07-24T07:22:45')
    expect(context.profileText).not.toContain('Last updated:')
  })
})
