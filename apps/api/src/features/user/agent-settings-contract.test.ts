import { describe, expect, test } from 'bun:test'
import { agentSettingsSchema, normalizeAgentSettings } from './contracts'

describe('agentSettingsSchema — only executable settings are advertised', () => {
  test('validates model parameters for distinct agents and rejects duplicate triples or invalid caps', () => {
    const entry = {
      agentId: 'a',
      providerId: 'openai',
      modelId: 'gpt-test',
      effort: 'high',
      maxTurns: 5,
    }
    expect(
      agentSettingsSchema.safeParse({
        agentModelSettings: [entry, { ...entry, agentId: 'b', maxTurns: 20 }],
      }).success,
    ).toBe(true)
    expect(agentSettingsSchema.safeParse({ agentModelSettings: [entry, entry] }).success).toBe(
      false,
    )
    for (const maxTurns of [0, -1, 1.5, 1001]) {
      expect(
        agentSettingsSchema.safeParse({ agentModelSettings: [{ ...entry, maxTurns }] }).success,
      ).toBe(false)
    }
  })

  test('stores availability, assignment, and reasoning in one workload route', () => {
    expect(
      agentSettingsSchema.parse({
        modelRouting: {
          titleGeneration: {
            enabled: false,
            providerConnectionId: 'conn',
            modelId: 'gpt-5.6',
            reasoningEffort: 'off',
          },
          inlineCompletion: { enabled: true },
          session: {
            reasoningPreferences: [
              {
                providerId: 'openai',
                modelId: 'openai/gpt-5.6',
                effort: 'low',
              },
              {
                providerId: 'openrouter',
                modelId: 'openrouter/gpt-5.6',
                effort: 'off',
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      modelRouting: {
        titleGeneration: {
          enabled: false,
          providerConnectionId: 'conn',
          modelId: 'gpt-5.6',
          reasoningEffort: 'off',
        },
        inlineCompletion: { enabled: true },
        session: {
          reasoningPreferences: [
            { providerId: 'openai', modelId: 'openai/gpt-5.6', effort: 'low' },
            {
              providerId: 'openrouter',
              modelId: 'openrouter/gpt-5.6',
              effort: 'off',
            },
          ],
        },
      },
    })
  })

  test('accepts per-route reasoning effort and rejects unknown values', () => {
    const input = {
      modelRouting: {
        inlineCompletion: {
          providerConnectionId: 'inline-conn',
          modelId: 'inline-model',
          reasoningEffort: 'low',
        },
        titleGeneration: {
          providerConnectionId: 'conn',
          modelId: 'model',
          reasoningEffort: 'max',
        },
      },
    } as const
    expect(agentSettingsSchema.parse(input)).toEqual(input)
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: {
          titleGeneration: {
            providerConnectionId: 'conn',
            modelId: 'model',
            reasoningEffort: 'turbo',
          },
        },
      }),
    ).toThrow()
  })

  test('rejects model-routing keys outside the shared workload catalog', () => {
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: { autocomplete: { enabled: true } },
      }),
    ).toThrow()
    // The summarizer's route went with LLM compaction (the migration strips stored copies).
    expect(() =>
      agentSettingsSchema.parse({ modelRouting: { compression: { modelId: 'model' } } }),
    ).toThrow()
  })

  test('rejects partial assignments and reasoning without a model', () => {
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: { session: { providerConnectionId: 'conn' } },
      }),
    ).toThrow()
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: { session: { modelId: 'model' } },
      }),
    ).toThrow()
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: { session: { reasoningEffort: 'low' } },
      }),
    ).toThrow()
  })

  test('validates the bounded provider/model reasoning memory inside each route', () => {
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: {
          session: {
            reasoningPreferences: [{ providerId: '', modelId: 'm', effort: 'low' }],
          },
        },
      }),
    ).toThrow()
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: {
          session: {
            reasoningPreferences: Array.from({ length: 51 }, (_, index) => ({
              providerId: 'p',
              modelId: `p/m-${index}`,
              effort: 'low',
            })),
          },
        },
      }),
    ).toThrow()
    expect(() =>
      agentSettingsSchema.parse({
        modelRouting: {
          session: {
            reasoningPreferences: [
              { providerId: 'p', modelId: 'm', effort: 'low' },
              { providerId: 'p', modelId: 'm', effort: 'max' },
            ],
          },
        },
      }),
    ).toThrow()
  })

  test('drops the removed schema-only fallback surfaces', () => {
    const parsed = agentSettingsSchema.parse({
      maxTurns: 12,
      fallbackTargets: [{ providerId: 'openai', modelId: 'gpt' }],
      auxiliaryRouting: {
        compression: [{ providerId: 'openai', modelId: 'gpt' }],
      },
    })

    expect(parsed).toEqual({ maxTurns: 12 })
    expect('fallbackTargets' in parsed).toBe(false)
    expect('auxiliaryRouting' in parsed).toBe(false)
  })

  test('a stored follow-edits toggle from before its removal still parses and is dropped', () => {
    const parsed = normalizeAgentSettings({
      gitBlame: { enabled: false },
      followAgentEdits: { enabled: true },
    })

    expect(parsed).toEqual({ gitBlame: { enabled: false } })
  })
})
