import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { loadUserProfile, PROFILE_CHAR_LIMIT } from './tools/memory/user-profile'
import { createUserProfileRepository } from '../user/repository'

const PROFILE_LIMIT_LABEL = PROFILE_CHAR_LIMIT.toLocaleString('en-US')

async function createTestDb() {
  const db = createDatabase() // in-memory
  await migrateToLatest(db)
  return db
}

// The profile is written by the settings UI / onboarding (and by `memory` scope="global"
// for what the model learns); these cover the READ side the system prompt injects.
describe('user profile prompt injection', () => {
  test('loadUserProfile is null on an empty profile', async () => {
    const db = await createTestDb()
    const profile = await loadUserProfile(createUserProfileRepository(db), 'user_1')
    expect(profile).toBeNull()
  })

  test('formats known fields, parsing the expertise JSON array', async () => {
    const db = await createTestDb()
    const repo = createUserProfileRepository(db)
    await repo.upsert('user_1', {
      name: 'Carol',
      role: 'product manager',
      expertise: JSON.stringify(['TypeScript', 'Go']),
      updated_at: new Date().toISOString(),
    })

    const profile = await loadUserProfile(repo, 'user_1')
    expect(profile).toContain('Name: Carol')
    expect(profile).toContain('Role: product manager')
    expect(profile).toContain('Expertise: TypeScript, Go')
  })

  test('profiles are isolated per user', async () => {
    const db = await createTestDb()
    const repo = createUserProfileRepository(db)
    await repo.upsert('user_1', { name: 'User One', updated_at: new Date().toISOString() })

    expect(await loadUserProfile(repo, 'user_2')).toBeNull()
  })

  test('injected profile shows budget usage headroom', async () => {
    const db = await createTestDb()
    const repo = createUserProfileRepository(db)
    await repo.upsert('user_1', { name: 'Ada', updated_at: new Date().toISOString() })

    const profile = await loadUserProfile(repo, 'user_1')
    expect(profile).toContain(`/${PROFILE_LIMIT_LABEL} chars`)
  })
})
