import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createUserService } from './service'
import { RESPONSE_DEFAULTS_MAX_CHARS } from './profile-limits'

async function createTestService() {
  const db = createDatabase() // in-memory
  await migrateToLatest(db)
  return { db, service: createUserService({ db, now: () => '2026-06-04T00:00:00.000Z' }) }
}

describe('createUserService', () => {
  test('getProfile returns an empty profile when none exists', async () => {
    const { service } = await createTestService()
    const profile = await service.getProfile('user_1')
    expect(profile.userId).toBe('user_1')
    expect(profile.name).toBeNull()
    expect(profile.uiSettings).toBeNull()
    expect(profile.agentSettings).toBeNull()
  })

  test('keeps oversized legacy profile text readable and normalizes stored settings', async () => {
    const { db, service } = await createTestService()
    const legacyDefaults = 'r'.repeat(RESPONSE_DEFAULTS_MAX_CHARS + 500)
    await db
      .insertInto('user_profiles')
      .values({
        user_id: 'legacy',
        response_defaults: legacyDefaults,
        ui_settings: JSON.stringify({ fontSize: 'lg', retiredTheme: true }),
        agent_settings: JSON.stringify({ contextExclusions: ['**/.env'], retiredFlag: true }),
        updated_at: '2025-01-01T00:00:00.000Z',
      })
      .execute()

    const profile = await service.getProfile('legacy')
    expect(profile.responseDefaults).toBe(legacyDefaults)
    expect(profile.uiSettings).toEqual({ fontSize: 'lg' })
    expect(profile.agentSettings).toEqual({ contextExclusions: ['**/.env'] })

    await db
      .updateTable('user_profiles')
      .set({
        ui_settings: JSON.stringify({ fontSize: 'enormous' }),
        agent_settings: JSON.stringify({ maxTurns: -1 }),
      })
      .where('user_id', '=', 'legacy')
      .execute()
    expect((await service.getProfile('legacy')).uiSettings).toBeNull()
    expect((await service.getProfile('legacy')).agentSettings).toBeNull()
  })

  test('persists safe Context Fabric exclusions in agent settings', async () => {
    const { service } = await createTestService()
    const saved = await service.updateProfile('user_1', {
      agentSettings: { contextExclusions: ['generated', 'private/local'] },
    })
    expect(saved.agentSettings?.contextExclusions).toEqual(['generated', 'private/local'])
  })

  test('updateProfile inserts a new row then reads it back', async () => {
    const { service } = await createTestService()
    const profile = await service.updateProfile('user_1', {
      name: 'Alice',
      role: 'Backend dev',
      uiSettings: { fontFamily: 'inter', fontSize: 'lg' },
      agentSettings: { contextExclusions: ['**/.env'] },
    })

    expect(profile.name).toBe('Alice')
    expect(profile.role).toBe('Backend dev')
    expect(profile.uiSettings).toEqual({ fontFamily: 'inter', fontSize: 'lg' })
    expect(profile.agentSettings).toEqual({ contextExclusions: ['**/.env'] })
  })

  test('updateProfile merges across calls without clobbering untouched fields', async () => {
    const { service } = await createTestService()
    await service.updateProfile('user_1', { name: 'Alice' })
    const after = await service.updateProfile('user_1', { role: 'QA' })

    // role added, name preserved by the upsert (only provided columns are written)
    expect(after.name).toBe('Alice')
    expect(after.role).toBe('QA')
  })

  test('concurrent agent-settings patches preserve unrelated fields and support deletion', async () => {
    const { service } = await createTestService()
    await service.updateProfile('user_1', {
      agentSettings: {
        contextExclusions: ['**/.env'],
        gitBlame: { enabled: true },
      },
    })

    await Promise.all([
      service.updateProfile('user_1', {
        agentSettingsPatch: { contextExclusions: ['**/.env', '**/secrets/**'] },
      }),
      service.updateProfile('user_1', {
        agentSettingsPatch: { research: { allowPrivate: true } },
      }),
    ])
    expect((await service.getProfile('user_1')).agentSettings).toEqual({
      contextExclusions: ['**/.env', '**/secrets/**'],
      gitBlame: { enabled: true },
      research: { allowPrivate: true },
    })

    const cleared = await service.updateProfile('user_1', {
      agentSettingsPatch: { gitBlame: null },
    })
    expect(cleared.agentSettings).toEqual({
      contextExclusions: ['**/.env', '**/secrets/**'],
      research: { allowPrivate: true },
    })
  })

  test('concurrent UI-settings patches preserve unrelated fields and support deletion', async () => {
    const { service } = await createTestService()
    await service.updateProfile('user_1', {
      uiSettings: {
        fontFamily: 'inter',
        fontSize: 'md',
        keymapPreset: 'default',
      },
    })

    await Promise.all([
      service.updateProfile('user_1', {
        uiSettingsPatch: { fontSize: 'lg' },
      }),
      service.updateProfile('user_1', {
        uiSettingsPatch: { codeFont: 'fragment-mono' },
      }),
    ])
    expect((await service.getProfile('user_1')).uiSettings).toEqual({
      fontFamily: 'inter',
      fontSize: 'lg',
      keymapPreset: 'default',
      codeFont: 'fragment-mono',
    })

    const cleared = await service.updateProfile('user_1', {
      uiSettingsPatch: { keymapPreset: null },
    })
    expect(cleared.uiSettings).toEqual({
      fontFamily: 'inter',
      fontSize: 'lg',
      codeFont: 'fragment-mono',
    })
  })

  test('persists experience level + main use case and reads them back', async () => {
    const { service } = await createTestService()
    const empty = await service.getProfile('user_1')
    expect(empty.experienceLevel).toBeNull()
    expect(empty.mainUseCase).toBeNull()

    const saved = await service.updateProfile('user_1', {
      experienceLevel: 'senior',
      mainUseCase: 'write-code',
    })
    expect(saved.experienceLevel).toBe('senior')
    expect(saved.mainUseCase).toBe('write-code')

    // Merge semantics: a later unrelated patch leaves them intact.
    const after = await service.updateProfile('user_1', { role: 'Backend dev' })
    expect(after.experienceLevel).toBe('senior')
    expect(after.mainUseCase).toBe('write-code')
  })

  test('round-trips one canonical optional model route', async () => {
    const { service } = await createTestService()
    const saved = await service.updateProfile('user_1', {
      agentSettings: {
        modelRouting: {
          inlineCompletion: {
            enabled: true,
            providerConnectionId: 'conn_1',
            modelId: 'flash-1',
          },
        },
      },
    })
    expect(saved.agentSettings).toEqual({
      modelRouting: {
        inlineCompletion: {
          enabled: true,
          providerConnectionId: 'conn_1',
          modelId: 'flash-1',
        },
      },
    })

    // Read it back on a fresh get — proves it persisted, not just echoed.
    const reloaded = await service.getProfile('user_1')
    expect(reloaded.agentSettings?.modelRouting?.inlineCompletion?.enabled).toBe(true)
    expect(reloaded.agentSettings?.modelRouting?.inlineCompletion).toEqual({
      enabled: true,
      providerConnectionId: 'conn_1',
      modelId: 'flash-1',
    })
  })

  test('persists reasoning memory by workload, provider, and model in the database', async () => {
    const { service } = await createTestService()
    await service.updateProfile('user_1', {
      agentSettings: {
        modelRouting: {
          session: {
            reasoningPreferences: [
              { providerId: 'openai', modelId: 'openai/gpt-5.6', effort: 'low' },
              { providerId: 'openrouter', modelId: 'openrouter/gpt-5.6', effort: 'max' },
            ],
          },
          titleGeneration: {
            enabled: false,
            reasoningPreferences: [
              { providerId: 'openai', modelId: 'openai/gpt-5.6', effort: 'off' },
            ],
          },
        },
      },
    })

    expect((await service.getProfile('user_1')).agentSettings?.modelRouting).toEqual({
      session: {
        reasoningPreferences: [
          { providerId: 'openai', modelId: 'openai/gpt-5.6', effort: 'low' },
          { providerId: 'openrouter', modelId: 'openrouter/gpt-5.6', effort: 'max' },
        ],
      },
      titleGeneration: {
        enabled: false,
        reasoningPreferences: [{ providerId: 'openai', modelId: 'openai/gpt-5.6', effort: 'off' }],
      },
    })
  })

  test('profiles are isolated per user', async () => {
    const { service } = await createTestService()
    await service.updateProfile('user_1', { name: 'Alice' })
    await service.updateProfile('user_2', { name: 'Bob' })

    expect((await service.getProfile('user_1')).name).toBe('Alice')
    expect((await service.getProfile('user_2')).name).toBe('Bob')
  })
})
