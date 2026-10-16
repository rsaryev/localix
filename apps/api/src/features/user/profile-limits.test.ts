import { describe, expect, test } from 'bun:test'

import {
  agentSettingsPatchSchema,
  agentSettingsSchema,
  normalizeAgentSettings,
  normalizeUiSettings,
  uiSettingsPatchSchema,
  updateUserProfileRequestSchema,
} from './contracts'
import {
  AGENT_SETTINGS_MAX_SERIALIZED_CHARS,
  UI_SETTINGS_MAX_SERIALIZED_CHARS,
  isAgentSettingsWithinIngressBudget,
} from './profile-limits'

describe('profile ingress budgets', () => {
  test('rejects retired personal profile fields', () => {
    for (const field of [
      'name',
      'role',
      'expertise',
      'workingContext',
      'experienceLevel',
      'mainUseCase',
      'responseDefaults',
    ]) {
      expect(updateUserProfileRequestSchema.safeParse({ [field]: 'retired' }).success).toBe(false)
    }
  })

  test('the ingress budget rejects a pathological blob, and ordinary settings pass', () => {
    const ordinary = { contextExclusions: ['**/.env'], maxTurns: 100 }
    expect(updateUserProfileRequestSchema.safeParse({ agentSettings: ordinary }).success).toBe(true)
    expect(agentSettingsSchema.safeParse(ordinary).success).toBe(true)
    expect(isAgentSettingsWithinIngressBudget(ordinary)).toBe(true)

    // Checked against the budget FUNCTION rather than through the request schema, because
    // every field the canonical schema still accepts is individually bounded — the unbounded
    // one, `disabledTools`, moved to `capability_policy`. The cap therefore cannot currently
    // be reached through a valid parse, and asserting that it can would be asserting a lie.
    // It is still the guard that stops a future unbounded field, so it is still tested.
    expect(
      isAgentSettingsWithinIngressBudget({
        contextExclusions: ['x'.repeat(AGENT_SETTINGS_MAX_SERIALIZED_CHARS)],
      }),
    ).toBe(false)
  })

  test('agent-settings patches delete with null and cannot drift from the canonical shape', () => {
    expect(agentSettingsPatchSchema.parse({ contextExclusions: null })).toEqual({
      contextExclusions: null,
    })
    expect(agentSettingsPatchSchema.safeParse({ retiredFlag: true }).success).toBe(false)
    expect(
      updateUserProfileRequestSchema.safeParse({
        agentSettings: { contextExclusions: ['**/.env'] },
        agentSettingsPatch: { contextExclusions: null },
      }).success,
    ).toBe(false)
  })

  test('UI-settings patches delete with null and cannot drift from the canonical shape', () => {
    expect(uiSettingsPatchSchema.parse({ fontSize: null })).toEqual({ fontSize: null })
    expect(uiSettingsPatchSchema.safeParse({ retiredTheme: 'dark' }).success).toBe(false)
    expect(
      updateUserProfileRequestSchema.safeParse({
        uiSettings: { fontSize: 'md' },
        uiSettingsPatch: { fontSize: null },
      }).success,
    ).toBe(false)
  })

  test('caps pathological new UI-settings blobs without changing the canonical schema', () => {
    const oversized = { keymapPreset: 'x'.repeat(UI_SETTINGS_MAX_SERIALIZED_CHARS) }
    expect(updateUserProfileRequestSchema.safeParse({ uiSettings: oversized }).success).toBe(false)
    expect(updateUserProfileRequestSchema.safeParse({ uiSettingsPatch: oversized }).success).toBe(
      false,
    )
  })
})

describe('stored agent settings normalization', () => {
  test('strips unknown legacy keys and rejects invalid known values', () => {
    expect(normalizeAgentSettings({ contextExclusions: ['**/.env'], retiredFlag: true })).toEqual({
      contextExclusions: ['**/.env'],
    })
    expect(normalizeAgentSettings({ maxTurns: -1 })).toBeNull()
    expect(normalizeAgentSettings('not-an-object')).toBeNull()
  })

  test('removed workloads are stripped without discarding current model routes', () => {
    expect(
      normalizeAgentSettings({
        modelRouting: {
          autocomplete: { enabled: false },
          retiredCompletion: { enabled: true },
          inlineCompletion: {
            enabled: true,
            providerConnectionId: 'codex',
            modelId: 'openai-codex/gpt-5.6-luna',
          },
        },
        aux: { retiredLegacyData: true },
      }),
    ).toEqual({
      modelRouting: {
        inlineCompletion: {
          enabled: true,
          providerConnectionId: 'codex',
          modelId: 'openai-codex/gpt-5.6-luna',
        },
      },
    })
  })
})

describe('stored UI settings normalization', () => {
  test('strips unknown legacy keys and rejects invalid known values', () => {
    expect(normalizeUiSettings({ fontSize: 'lg', retiredTheme: true })).toEqual({
      fontSize: 'lg',
    })
    expect(normalizeUiSettings({ fontSize: 'enormous' })).toBeNull()
    expect(normalizeUiSettings('not-an-object')).toBeNull()
  })
})
