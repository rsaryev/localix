import { describe, expect, test } from 'bun:test'

import { reasoningLevels } from './model-facts'
import { normalize } from './normalize'

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  attachment: false,
  reasoning: false,
  tool_call: true,
  release_date: '2026-01-01',
  last_updated: '2026-01-01',
  modalities: { input: ['text'], output: ['text'] },
  open_weights: false,
  limit: { context: 100_000, output: 8_000 },
  ...extra,
})

describe('reasoning levels, by models.dev authoring rules', () => {
  const levels = (options: unknown, family?: 'anthropic' | 'openai') =>
    reasoningLevels(
      { reasoning: true, reasoning_options: options as never },
      family ? { family } : undefined,
    )

  test('effort names the levels; none or null among them is off', () => {
    expect(
      levels([{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }]),
    ).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
    expect(levels([{ type: 'effort', values: [null, 'high', 'default'] }])).toEqual(['off', 'high'])
    expect(levels([{ type: 'effort', values: ['low', 'high', 'max'] }])).toEqual([
      'low',
      'high',
      'max',
    ])
  })

  test('a toggle switches off; beside effort it adds off, alone it is off and on', () => {
    expect(
      levels([{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }]),
    ).toEqual(['off', 'low', 'high', 'max'])
    expect(levels([{ type: 'toggle' }])).toEqual(['off', 'medium'])
  })

  test('a budget offers the common three, and off only without a floor', () => {
    expect(levels([{ type: 'budget_tokens', min: 128, max: 32_768 }])).toEqual([
      'low',
      'medium',
      'high',
    ])
    expect(levels([{ type: 'budget_tokens', min: 0 }])).toEqual(['off', 'low', 'medium', 'high'])
  })

  test('no option is reasoning beyond control; the Anthropic wire always takes off', () => {
    expect(levels([])).toEqual([])
    expect(levels([{ type: 'budget_tokens', min: 1024 }], 'anthropic')).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ])
    expect(reasoningLevels({ reasoning: false })).toEqual([])
  })
})

describe('normalizing models.dev', () => {
  const providers = {
    copilot: {
      id: 'copilot',
      name: 'Copilot',
      npm: '@ai-sdk/openai-compatible',
      api: 'https://api.copilot.test',
      env: [],
      doc: 'https://docs',
      models: {
        'gpt-x': model('gpt-x', { provider: { npm: '@ai-sdk/openai' } }),
        'claude-x': model('claude-x', {
          provider: { npm: '@ai-sdk/anthropic', api: 'https://api.copilot.test/v1' },
        }),
        'gemini-x': model('gemini-x'),
        templated: model('templated', { provider: { api: 'https://${RESOURCE}.example/v1' } }),
        embed: model('embed', { type: 'embedding' }),
        speaker: model('speaker', { modalities: { input: ['text'], output: ['audio'] } }),
      },
    },
    openai: {
      id: 'openai',
      name: 'OpenAI',
      npm: '@ai-sdk/openai',
      env: ['OPENAI_API_KEY'],
      doc: 'https://docs',
      models: {
        'gpt-6-luna': model('gpt-6-luna', {
          reasoning: true,
          temperature: false,
          reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high'] }],
          limit: { context: 1_050_000, input: 922_000, output: 128_000 },
          cost: {
            input: 0.1,
            output: 0.5,
            tiers: [{ input: 0.2, output: 0.75, tier: { type: 'context', size: 272_000 } }],
          },
        }),
        'gpt-old': model('gpt-old', { provider: { shape: 'completions' } }),
      },
    },
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      npm: '@openrouter/ai-sdk-provider',
      api: 'https://openrouter.ai/api/v1',
      env: ['OPENROUTER_API_KEY'],
      doc: 'https://docs',
      models: {
        'liquid/d1': model('liquid/d1', { type: 'decision', cost: { input: 0.02, output: 0.1 } }),
        // models.dev names the vendor's own client package on some decision models (Jev).
        '~typesafe/jev-latest': model('~typesafe/jev-latest', {
          type: 'decision',
          provider: { npm: '@ai-sdk/typesafe-ai' },
        }),
      },
    },
    elsewhere: {
      id: 'elsewhere',
      name: 'Elsewhere',
      npm: '@ai-sdk/openai-compatible',
      api: 'https://elsewhere.test/v1',
      env: ['KEY'],
      doc: 'https://docs',
      models: {
        judge: model('judge', { type: 'decision' }),
        groq: model('groq', { provider: { npm: '@ai-sdk/groq', api: undefined } }),
      },
    },
    unserved: {
      id: 'unserved',
      name: 'Unserved',
      npm: 'some-private-sdk',
      env: ['KEY'],
      doc: '',
      models: { a: model('a') },
    },
    broken: { id: 'broken', name: 7, models: {} },
  }
  const document = normalize(providers)

  test("routes each model its own way: a model's package and address over its provider's", () => {
    const copilot = document.copilot!
    expect(copilot.route).toEqual({
      family: 'openai-compatible',
      baseURL: 'https://api.copilot.test',
    })
    expect(copilot.chat['gpt-x']?.route).toEqual({
      family: 'openai',
      baseURL: 'https://api.copilot.test',
    })
    expect(copilot.chat['claude-x']?.route).toEqual({
      family: 'anthropic',
      baseURL: 'https://api.copilot.test/v1',
    })
    expect(copilot.chat['gemini-x']?.route).toEqual(copilot.route)
    expect(document.openai?.chat['gpt-old']?.route).toEqual({
      family: 'openai',
      shape: 'completions',
    })
    expect(document.elsewhere?.chat.groq?.route).toEqual({
      family: 'openai-compatible',
      baseURL: 'https://elsewhere.test/v1',
    })
  })

  test('keeps chat and the decision models a provider SDK can serve, in separate maps', () => {
    expect(Object.keys(document.copilot!.chat).sort()).toEqual(['claude-x', 'gemini-x', 'gpt-x'])
    expect(Object.keys(document.openrouter!.decision)).toEqual([
      'liquid/d1',
      '~typesafe/jev-latest',
    ])
    // A decision model naming only its vendor's package is served at its provider's address.
    expect(document.openrouter!.decision['~typesafe/jev-latest']?.route).toEqual(
      document.openrouter!.route,
    )
    expect(document.openrouter!.decision['liquid/d1']).toMatchObject({
      output: ['decisions'],
      tools: false,
      cost: { input: 0.02, output: 0 },
    })
    expect(document.elsewhere!.decision).toEqual({})
    expect(document.openai!.chat['gpt-6-luna']).toBeDefined()
    expect(document.openai!.decision['gpt-6-luna']).toBeDefined()
    expect(document.unserved).toBeUndefined()
    expect(document.broken).toBeUndefined()
  })

  test('caps the context at the first price tier, and derives the ChatGPT plan through Codex', () => {
    expect(document.openai!.chat['gpt-6-luna']).toMatchObject({
      contextWindow: 272_000,
      temperature: false,
      reasons: true,
      reasoning: ['off', 'low', 'high'],
    })
    expect(document['openai-codex']!.chat['gpt-6-luna']).toMatchObject({
      route: { family: 'openai', baseURL: 'https://chatgpt.com/backend-api/codex' },
      contextWindow: 272_000,
    })
  })

  test('a cloud lists what its connection names besides the key, and keeps only addresses it can fill', () => {
    const clouds = normalize({
      azure: {
        id: 'azure',
        name: 'Azure',
        npm: '@ai-sdk/azure',
        env: ['AZURE_RESOURCE_NAME', 'AZURE_API_KEY'],
        doc: 'https://docs',
        models: {
          'gpt-x': model('gpt-x'),
          'claude-x': model('claude-x', {
            provider: {
              npm: '@ai-sdk/anthropic',
              api: 'https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1',
            },
          }),
        },
      },
      'google-vertex': {
        id: 'google-vertex',
        name: 'Vertex',
        npm: '@ai-sdk/google-vertex',
        env: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS'],
        doc: 'https://docs',
        models: {
          'gemini-x': model('gemini-x'),
          // An address naming a variable the connection never sets cannot be reached.
          'mistral-x': model('mistral-x', {
            provider: {
              npm: '@ai-sdk/openai-compatible',
              api: 'https://${GOOGLE_VERTEX_ENDPOINT}/v1/models',
            },
          }),
        },
      },
    })
    expect(clouds.azure?.settings.map((setting) => setting.name)).toEqual(['AZURE_RESOURCE_NAME'])
    expect(clouds.azure?.chat['claude-x']?.route).toEqual({
      family: 'anthropic',
      baseURL: 'https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1',
    })
    expect(
      clouds['google-vertex']?.settings.map((setting) => [setting.name, setting.required]),
    ).toEqual([
      ['GOOGLE_VERTEX_PROJECT', false],
      ['GOOGLE_VERTEX_LOCATION', false],
    ])
    expect(Object.keys(clouds['google-vertex']?.chat ?? {})).toEqual(['gemini-x'])
  })
})
