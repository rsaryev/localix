import { describe, expect, test } from 'bun:test'
import {
  EFFECTIVE_CONFIG_SCHEMA_VERSION,
  migrateAgentSettings,
  migrateProjectSettings,
  resolveEffectiveAgentConfig,
} from './effective-config'

/**
 * What a scope may USE — tools, skills, permissions — is no longer resolved here. It lives in
 * `capability_policy` and is answered by `features/capabilities/resolve.ts`, whose own tests
 * own the layering rule. What is left in this resolver is the settings a project OVERRIDES
 * rather than subtracts from, and that is what these cases cover.
 */
describe('effective agent configuration', () => {
  test('migrates an unversioned user blob to the current schema without mutating it', () => {
    const legacy = { maxTurns: 12 }
    const result = migrateAgentSettings(legacy)

    expect(result).toEqual({
      ok: true,
      fromVersion: 0,
      toVersion: EFFECTIVE_CONFIG_SCHEMA_VERSION,
      value: { schemaVersion: EFFECTIVE_CONFIG_SCHEMA_VERSION, maxTurns: 12 },
    })
    expect(legacy).toEqual({ maxTurns: 12 })
  })

  test('accepts current versioned settings and rejects future or malformed blobs', () => {
    expect(migrateProjectSettings({ schemaVersion: 1, modelId: 'model-a' })).toMatchObject({
      ok: true,
      fromVersion: 1,
    })
    expect(migrateProjectSettings({ schemaVersion: 2 })).toEqual({
      ok: false,
      issues: ['project settings schemaVersion must be 0 or 1'],
    })
    expect(migrateAgentSettings(['not', 'an', 'object'])).toEqual({
      ok: false,
      issues: ['user settings must be an object'],
    })
  })

  test('a project value overrides the user one, and provenance says so', () => {
    const result = resolveEffectiveAgentConfig({
      userSettings: { modelId: 'user/model' },
      projectSettings: { modelId: 'project/model' },
      projectScoped: true,
    })

    expect(result.settings.modelId).toBe('project/model')
    expect(result.provenance.modelId).toBe('project')
  })

  test('context exclusions MERGE across scopes rather than overriding', () => {
    // The one setting here that composes: an exclusion is a restriction, and a project must
    // be able to add to the user's without silently dropping them.
    const result = resolveEffectiveAgentConfig({
      defaults: { contextExclusions: ['**/.env'] },
      userSettings: { contextExclusions: ['**/secrets/**'] },
      projectSettings: { contextExclusions: ['**/vendor/**'] },
      projectScoped: true,
    })

    expect(result.settings.contextExclusions).toEqual(['**/.env', '**/secrets/**', '**/vendor/**'])
    expect(result.provenance.contextExclusions).toBe('merged')
  })

  test('isolates invalid settings and surfaces diagnostics', () => {
    const result = resolveEffectiveAgentConfig({
      userSettings: { maxTurns: 0 },
      projectSettings: { modelId: 'project/model' },
    })

    expect(result.settings.modelId).toBe('project/model')
    expect(result.diagnostics).toContain(
      'user settings maxTurns: Too small: expected number to be >0',
    )
  })
})
