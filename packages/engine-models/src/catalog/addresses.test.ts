import { describe, expect, test } from 'bun:test'

import { normalize } from './normalize'

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
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

const provider = (id: string, npm: string, api: string | undefined, models: object) => ({
  id,
  name: id,
  npm,
  ...(api ? { api } : {}),
  env: [],
  doc: 'https://docs',
  models,
})

/** models.dev decides where each key goes; one bad entry must not redirect anyone's key. */
describe('where a key may go', () => {
  test("a first-party provider's key goes only to its own host, whatever the document says", () => {
    const document = normalize({
      openrouter: provider('openrouter', '@openrouter/ai-sdk-provider', 'https://evil.test/v1', {
        a: model('a'),
        b: model('b', { provider: { api: 'https://evil.test/v2' } }),
      }),
      openai: provider('openai', '@ai-sdk/openai', 'https://evil.test/v1', { c: model('c') }),
      'github-copilot': provider(
        'github-copilot',
        '@ai-sdk/openai-compatible',
        'https://api.githubcopilot.com',
        {
          d: model('d', {
            provider: { npm: '@ai-sdk/anthropic', api: 'https://api.githubcopilot.com/v1' },
          }),
        },
      ),
    })
    expect(document.openrouter?.route.baseURL).toBe('https://openrouter.ai/api/v1')
    expect(Object.keys(document.openrouter?.chat ?? {})).toEqual(['a'])
    expect(document.openai?.route.baseURL).toBe('https://api.openai.com/v1')
    expect(document['github-copilot']?.chat.d?.route.baseURL).toBe(
      'https://api.githubcopilot.com/v1',
    )
  })

  test("a model's own address stays on its provider's origin, or inside its cloud", () => {
    const document = normalize({
      acme: provider('acme', '@ai-sdk/openai-compatible', 'https://api.acme.test/v1', {
        same: model('same', { provider: { api: 'https://api.acme.test/v2' } }),
        away: model('away', { provider: { api: 'https://other.test/v1' } }),
      }),
      'amazon-bedrock': {
        ...provider('amazon-bedrock', '@ai-sdk/amazon-bedrock', undefined, {
          gpt: model('gpt', {
            provider: {
              npm: '@ai-sdk/openai',
              api: 'https://bedrock-mantle.${AWS_REGION}.api.aws/openai/v1',
            },
          }),
          stray: model('stray', {
            provider: { npm: '@ai-sdk/openai', api: 'https://${AWS_REGION}.evil.test/v1' },
          }),
        }),
        env: ['AWS_REGION', 'AWS_BEARER_TOKEN_BEDROCK'],
      },
    })
    expect(Object.keys(document.acme?.chat ?? {})).toEqual(['same'])
    expect(Object.keys(document['amazon-bedrock']?.chat ?? {})).toEqual(['gpt'])
  })

  test('every address is https, except one on this computer', () => {
    const document = normalize({
      plain: provider('plain', '@ai-sdk/openai-compatible', 'http://api.plain.test/v1', {
        a: model('a'),
      }),
      studio: provider('studio', '@ai-sdk/openai-compatible', 'http://127.0.0.1:1234/v1', {
        b: model('b'),
      }),
    })
    expect(document.plain).toBeUndefined()
    expect(document.studio?.route.baseURL).toBe('http://127.0.0.1:1234/v1')
  })

  test('the ids the engine serves itself, and prototype keys, are never taken from the document', () => {
    const document = normalize(
      JSON.parse(
        JSON.stringify({
          local: provider('local', '@ai-sdk/openai-compatible', 'https://evil.test/v1', {
            a: model('a'),
          }),
          acme: provider('acme', '@ai-sdk/openai-compatible', 'https://api.acme.test/v1', {
            ok: model('ok'),
            constructor: model('constructor'),
          }),
        }).replace('"local"', '"__proto__"'),
      ),
    )
    expect(Object.keys(document)).not.toContain('__proto__')
    expect(Object.keys(document.acme?.chat ?? {})).toEqual(['ok'])
    expect(
      normalize({
        local: provider('local', '@ai-sdk/openai-compatible', 'https://evil.test/v1', {
          a: model('a'),
        }),
      }).local,
    ).toBeUndefined()
  })
})
