import { describe, expect, test } from 'bun:test'
import { catalogResponseSchema } from './contracts'

describe('catalogResponseSchema', () => {
  test('preserves tiered token pricing across the API contract', () => {
    const parsed = catalogResponseSchema.parse({
      providers: [],
      oauthProviders: [],
      models: [
        {
          id: 'openai/test',
          name: 'test',
          providerId: 'openai',
          providerName: 'OpenAI',
          supportsTools: true,
          supportsReasoning: true,
          supportsAttachment: false,
          inputModalities: ['text'],
          outputModalities: ['text'],
          cost: {
            input: 2,
            output: 10,
            tiers: [{ inputTokensAbove: 200_000, input: 4, output: 15 }],
          },
        },
      ],
    })
    expect(parsed.models[0]?.cost?.tiers).toEqual([
      { inputTokensAbove: 200_000, input: 4, output: 15 },
    ])
  })
})
