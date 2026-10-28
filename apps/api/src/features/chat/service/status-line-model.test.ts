import { describe, expect, test } from 'bun:test'

import { statusLineModelInfo } from './status-line-model'

/** The status line names a model as the picker does, from the catalog; unknown models are not named. */
const model = (id: string, providerId: string, name: string, contextLength?: number) => ({
  id,
  name,
  providerId,
  providerName: providerId,
  ...(contextLength ? { contextLength } : {}),
  supportsTools: true,
  supportsReasoning: true,
  supportsAttachment: false,
  inputModalities: [],
  outputModalities: [],
})

const info = statusLineModelInfo({
  catalogService: {
    getCatalog: async () => ({
      providers: [],
      models: [
        model('anthropic/claude-haiku-5.5', 'openrouter', 'Claude Haiku 5.5', 200_000),
        model('gpt-5', 'openai', 'GPT-5'),
      ],
    }),
  },
  providerConnectionsService: {
    listConnections: async () => ({ connections: [{ id: 'or-key', providerId: 'openrouter' }] }),
  },
} as never)

describe('the model a status line names', () => {
  test('through the route connection', async () => {
    expect(
      await info('u1', { providerConnectionId: 'or-key', modelId: 'anthropic/claude-haiku-5.5' }),
    ).toEqual({ name: 'Claude Haiku 5.5', contextLength: 200_000, supportsReasoning: true })
  })

  test('by id when the route names no connection; no window when the catalog has none', async () => {
    expect(await info('u1', { providerConnectionId: null, modelId: 'gpt-5' })).toEqual({
      name: 'GPT-5',
      supportsReasoning: true,
    })
  })

  test('an unknown model is not named', async () => {
    expect(await info('u1', { providerConnectionId: null, modelId: 'mystery' })).toEqual({})
  })
})
