import { describe, expect, test } from 'bun:test'
import { listPiCatalog } from '@localixai/agent-runtime-pi'

import { createCatalogService } from '../features/catalog/service'
import { createEnvDetect } from '../features/provider-connections/env-detect'

/**
 * Env-key detection through the catalog the composition root actually builds.
 *
 * Here, where the pi adapter and the feature meet, because each side's own test hid the gap: the
 * env-detect test injects `env` in its provider fixture, and the adapter never filled that field —
 * so a server started with `ANTHROPIC_API_KEY` set answered `{"providers":[]}`.
 */
describe('env-key detection over the real pi catalog', () => {
  const detect = (env: Record<string, string | undefined>, connected: string[] = []) => {
    const catalogService = createCatalogService({
      source: {
        list: () => listPiCatalog({ fetch: async () => new Response(null, { status: 503 }) }),
      },
    })
    return createEnvDetect({
      env,
      catalogProviders: () => catalogService.getCatalog().then((catalog) => catalog.providers),
      connectedProviderIds: async () => new Set(connected),
      createConnection: async () => {
        throw new Error('not exercised')
      },
    })
  }

  test('keys present in the environment are detected by provider', async () => {
    const { providers } = await detect({
      ANTHROPIC_API_KEY: 'sk-ant-dummy',
      OPENAI_API_KEY: 'sk-dummy',
    }).listEnvDetectedProviders('u')
    expect(providers).toContainEqual({
      providerId: 'anthropic',
      providerName: 'Anthropic',
      envVar: 'ANTHROPIC_API_KEY',
    })
    expect(providers).toContainEqual({
      providerId: 'openai',
      providerName: 'OpenAI',
      envVar: 'OPENAI_API_KEY',
    })
    expect(JSON.stringify(providers)).not.toContain('dummy')
  })

  test('a provider with no chat models is not offered, even with its key set', async () => {
    // `typesafe` serves classifiers only: connecting it would give the picker nothing to show.
    const { providers } = await detect({ TYPESAFE_API_KEY: 'dummy' }).listEnvDetectedProviders('u')
    expect(providers).toEqual([])
  })

  test('nothing set, nothing detected; a connected provider is not offered again', async () => {
    expect((await detect({}).listEnvDetectedProviders('u')).providers).toEqual([])
    const { providers } = await detect({ OPENAI_API_KEY: 'sk-dummy' }, [
      'openai',
    ]).listEnvDetectedProviders('u')
    expect(providers).toEqual([])
  })
})
