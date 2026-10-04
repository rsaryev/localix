import { beforeEach, describe, expect, test } from 'bun:test'

import { resetCatalogMetadataRefreshState } from './catalog-metadata'
import { listPiCatalog } from './models'

beforeEach(() => resetCatalogMetadataRefreshState())

/**
 * The catalog carries each provider's API-key env-var names, asked of the provider's own resolver.
 *
 * Through the REAL projection on purpose: the env-detect unit test injects `env` in its fixture,
 * so it passed while the projection never filled the field and a server started with
 * `ANTHROPIC_API_KEY` set detected nothing.
 */
describe('provider API-key env vars in the catalog', () => {
  const catalog = () => listPiCatalog({ fetch: async () => new Response(null, { status: 503 }) })

  test('the standard keys are named for their providers', async () => {
    const { providers } = await catalog()
    const env = (id: string) => providers.find((provider) => provider.id === id)?.env
    expect(env('anthropic')).toContain('ANTHROPIC_API_KEY')
    expect(env('openai')).toEqual(['OPENAI_API_KEY'])
    expect(env('openrouter')).toEqual(['OPENROUTER_API_KEY'])
  })

  test('a variable the resolver does not turn into a bare key is not offered as one', async () => {
    const { providers } = await catalog()
    const env = (id: string) => providers.find((provider) => provider.id === id)?.env ?? []
    // Sent as a bearer header, not as a key: connecting it as an api key would not authenticate.
    expect(env('anthropic')).not.toContain('ANTHROPIC_AUTH_TOKEN')
    // Ambient AWS sources are credentials the environment keeps, not one pasteable secret.
    expect(env('amazon-bedrock')).toEqual([])
  })
})
