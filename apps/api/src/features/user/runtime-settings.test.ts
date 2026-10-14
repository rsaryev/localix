import { describe, expect, test } from 'bun:test'
import { loadUserSettingsContext } from './runtime-settings'
import type { UserProfileRepository, UserProfileRow } from './repository'

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

describe('user runtime settings', () => {
  test('runtime reads normalize legacy agent settings before consumers see them', async () => {
    const { repo } = makeRepo({
      agent_settings: JSON.stringify({ contextExclusions: ['**/.env'], retiredFlag: true }),
    })
    expect((await loadUserSettingsContext(repo, 'u1')).agentSettings).toEqual({
      contextExclusions: ['**/.env'],
    })

    const invalid = makeRepo({ agent_settings: JSON.stringify({ maxTurns: -1 }) })
    expect((await loadUserSettingsContext(invalid.repo, 'u1')).agentSettings).toBeNull()
  })

  test('an absent settings row uses runtime defaults', async () => {
    expect(await loadUserSettingsContext(makeRepo().repo, 'u1')).toEqual({ agentSettings: null })
  })
})
