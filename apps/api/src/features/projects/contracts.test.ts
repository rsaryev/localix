import { describe, expect, test } from 'bun:test'
import {
  PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS,
  PROJECT_SETTINGS_MAX_SERIALIZED_CHARS,
  projectRef,
  permissionRuleSchema,
  createProjectRequestSchema,
  expandRefsRequestSchema,
  contextRefSchema,
  normalizeProjectSettings,
  projectSettingsPatchSchema,
  updateProjectRequestSchema,
} from './contracts'
import { MODEL_ID_MAX_CHARS, PROVIDER_CONNECTION_ID_MAX_CHARS } from '../catalog/model-identity'

describe('projectRef', () => {
  test('formats the canonical PRJ-<seq> id', () => {
    expect(projectRef(3)).toBe('PRJ-3')
    expect(projectRef(0)).toBe('PRJ-0')
  })
})

describe('permissionRuleSchema', () => {
  test('defaults pattern to "*" and enforces the action enum', () => {
    const parsed = permissionRuleSchema.parse({ permission: 'bash', action: 'allow' })
    expect(parsed.pattern).toBe('*')
    expect(permissionRuleSchema.safeParse({ permission: 'bash', action: 'maybe' }).success).toBe(
      false,
    )
  })
})

describe('createProjectRequestSchema', () => {
  test('requires non-empty name and workingDir', () => {
    expect(createProjectRequestSchema.safeParse({ name: 'p', workingDir: '/w' }).success).toBe(true)
    expect(createProjectRequestSchema.safeParse({ name: '', workingDir: '/w' }).success).toBe(false)
    expect(createProjectRequestSchema.safeParse({ name: 'p', workingDir: '' }).success).toBe(false)
  })
})

describe('project settings updates', () => {
  test('accepts null field deletion and rejects unknown patch fields', () => {
    expect(projectSettingsPatchSchema.parse({ customSystemPrompt: null })).toEqual({
      customSystemPrompt: null,
    })
    expect(projectSettingsPatchSchema.safeParse({ unknown: true }).success).toBe(false)
  })

  test('does not allow full replacement and atomic patch in one request', () => {
    expect(
      updateProjectRequestSchema.safeParse({
        settings: { contextExclusions: ['**/.env'] },
        settingsPatch: { contextExclusions: null },
      }).success,
    ).toBe(false)
  })

  test('bounds custom project instructions on both update paths', () => {
    const oversized = 'x'.repeat(PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS + 1)
    expect(
      updateProjectRequestSchema.safeParse({
        settings: { customSystemPrompt: oversized },
      }).success,
    ).toBe(false)
    expect(projectSettingsPatchSchema.safeParse({ customSystemPrompt: oversized }).success).toBe(
      false,
    )
  })

  test('bounds durable project model identities on both update paths', () => {
    for (const field of ['modelId', 'providerConnectionId'] as const) {
      const max = field === 'modelId' ? MODEL_ID_MAX_CHARS : PROVIDER_CONNECTION_ID_MAX_CHARS
      expect(projectSettingsPatchSchema.safeParse({ [field]: '' }).success).toBe(false)
      expect(projectSettingsPatchSchema.safeParse({ [field]: 'x'.repeat(max) }).success).toBe(true)
      expect(projectSettingsPatchSchema.safeParse({ [field]: 'x'.repeat(max + 1) }).success).toBe(
        false,
      )
    }
  })

  test('bounds the complete project-settings envelope on both update paths', () => {
    const oversized = ['x'.repeat(PROJECT_SETTINGS_MAX_SERIALIZED_CHARS)]
    expect(
      updateProjectRequestSchema.safeParse({ settings: { contextExclusions: oversized } }).success,
    ).toBe(false)
    expect(projectSettingsPatchSchema.safeParse({ disabledTools: oversized }).success).toBe(false)
  })

  test('normalizes stored settings through the canonical schema', () => {
    expect(normalizeProjectSettings({ contextExclusions: ['**/.env'], retiredFlag: true })).toEqual(
      {
        contextExclusions: ['**/.env'],
      },
    )
    expect(normalizeProjectSettings({ contextExclusions: 'not-a-list' })).toBeNull()
    expect(normalizeProjectSettings('not-an-object')).toBeNull()
  })
})

describe('contextRefSchema', () => {
  test('enforces the kind enum and a 1-indexed start line', () => {
    expect(contextRefSchema.safeParse({ raw: '@file:x', kind: 'file', startLine: 1 }).success).toBe(
      true,
    )
    expect(contextRefSchema.safeParse({ raw: '@x', kind: 'bogus' }).success).toBe(false)
    expect(contextRefSchema.safeParse({ raw: '@file:x', kind: 'file', startLine: 0 }).success).toBe(
      false,
    )
  })
})

describe('expandRefsRequestSchema', () => {
  const ref = { raw: '@file:x', kind: 'file' as const }
  test('refs must number between 1 and 20', () => {
    expect(expandRefsRequestSchema.safeParse({ refs: [ref] }).success).toBe(true)
    expect(expandRefsRequestSchema.safeParse({ refs: [] }).success).toBe(false)
    expect(expandRefsRequestSchema.safeParse({ refs: Array(21).fill(ref) }).success).toBe(false)
  })
})
