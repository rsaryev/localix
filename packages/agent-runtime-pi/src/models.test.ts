import { describe, expect, test } from 'bun:test'

import { listPiCatalog } from './catalog'
import { createPiModels } from './models'

function openAiModelId(): string {
  const models = createPiModels(
    { providerId: 'openai', modelId: 'unused' },
    { type: 'api-key', key: 'discovery' },
  )
  const model = models.getModels('openai')[0]
  if (!model) throw new Error('Pi OpenAI catalog is empty')
  return model.id
}

describe('pi catalog projection', () => {
  test('carries pi’s generated release dates', async () => {
    const catalog = await listPiCatalog()
    expect(catalog.models.some((model) => model.releaseDate)).toBe(true)
  })

  test('serves the full native catalog offline', async () => {
    const catalog = await listPiCatalog()

    expect(catalog.models.length).toBeGreaterThan(0)
    expect(catalog.providers.length).toBeGreaterThan(0)
  })

  test('returns isolated DTOs from the cached native catalog projection', async () => {
    const first = await listPiCatalog()
    const expectedName = first.models[0]?.name
    if (!first.models[0] || !expectedName) throw new Error('Pi catalog is empty')
    first.models[0].name = 'caller mutation'

    const second = await listPiCatalog()

    expect(second.models[0]?.name).toBe(expectedName)
  })
})

describe('pi run model collection', () => {
  test('registers only the selected shared provider and keeps credentials request-scoped', async () => {
    const modelId = openAiModelId()
    const first = createPiModels(
      { providerId: 'openai', modelId },
      { type: 'api-key', key: 'key-first' },
    )
    const second = createPiModels(
      { providerId: 'openai', modelId },
      { type: 'api-key', key: 'key-second' },
    )
    const firstModel = first.getModel('openai', modelId)
    const secondModel = second.getModel('openai', modelId)
    if (!firstModel || !secondModel) throw new Error('Pi OpenAI model is unavailable')

    expect(first).not.toBe(second)
    expect(first.getProviders()).toHaveLength(1)
    expect(second.getProviders()).toHaveLength(1)
    expect(first.getProvider('openai')).toBe(second.getProvider('openai'))
    expect(first.getAuth(firstModel)).resolves.toMatchObject({ auth: { apiKey: 'key-first' } })
    expect(second.getAuth(secondModel)).resolves.toMatchObject({ auth: { apiKey: 'key-second' } })
  })
})
