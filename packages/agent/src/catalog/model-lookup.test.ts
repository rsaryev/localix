import { describe, expect, test } from 'bun:test'
import type { CatalogModel } from './types'
import {
  findCatalogModel,
  findCatalogModelForConnection,
  resolveLiveCatalogModel,
} from './model-lookup'

const model = (providerId: string, name: string): CatalogModel => ({
  id: 'shared-model',
  name,
  providerId,
  providerName: providerId,
  supportsTools: true,
  supportsReasoning: true,
  supportsAttachment: false,
  inputModalities: ['text'],
  outputModalities: ['text'],
})

describe('connection-scoped catalog lookup', () => {
  test('uses the exact connection provider when model ids collide', () => {
    const models = [model('proxy', 'Proxy model'), model('openai', 'OpenAI model')]
    const connections = [
      { id: 'openai-oauth', providerId: 'openai' },
      { id: 'proxy-key', providerId: 'proxy' },
    ]

    expect(
      findCatalogModelForConnection(models, connections, 'openai-oauth', 'shared-model')?.name,
    ).toBe('OpenAI model')
    expect(
      findCatalogModelForConnection(models, connections, 'proxy-key', 'shared-model')?.name,
    ).toBe('Proxy model')
  })

  test('does not silently fall back to another provider or removed connection', () => {
    const models = [model('proxy', 'Proxy model')]
    const connections = [{ id: 'openai-oauth', providerId: 'openai' }]

    expect(
      findCatalogModelForConnection(models, connections, 'openai-oauth', 'shared-model'),
    ).toBeUndefined()
    expect(
      findCatalogModelForConnection(models, connections, 'removed', 'shared-model'),
    ).toBeUndefined()
  })

  test('normalizes provider-prefixed and bare ids without crossing providers', () => {
    const openai: CatalogModel = {
      ...model('openai', 'OpenAI model'),
      id: 'openai/shared-model',
      contextLength: 400_000,
      outputLimit: 128_000,
      inputModalities: ['text', 'image'],
    }
    const proxy: CatalogModel = {
      ...model('proxy', 'Proxy model'),
      contextLength: 32_000,
      outputLimit: 4_000,
      inputModalities: ['text'],
    }
    const models = [proxy, openai]

    expect(findCatalogModel(models, 'openai', 'shared-model')).toBe(openai)
    expect(findCatalogModel(models, 'openai', 'openai/shared-model')).toBe(openai)
    expect(findCatalogModel(models, 'proxy', 'proxy/shared-model')).toBe(proxy)
    expect(findCatalogModel(models, 'missing', 'shared-model')).toBeUndefined()
    expect(findCatalogModel(models, null, 'shared-model')).toBeUndefined()
    expect(findCatalogModel(models, null, 'openai/shared-model')).toBe(openai)
  })

  test('rebinds a deleted connection by provider while ambiguous bare ids fail closed', () => {
    const models = [model('proxy', 'Proxy model'), model('openai', 'OpenAI model')]
    const connections = [
      { id: 'proxy-key', providerId: 'proxy' },
      { id: 'openai-new', providerId: 'openai' },
    ]

    expect(
      resolveLiveCatalogModel(models, connections, 'openai/shared-model', 'openai-deleted'),
    ).toEqual({ connection: connections[1], model: models[1] })
    expect(resolveLiveCatalogModel(models, connections, 'shared-model', 'deleted')).toBeNull()
    expect(resolveLiveCatalogModel(models, [connections[1]!], 'shared-model', 'deleted')).toEqual({
      connection: connections[1],
      model: models[1],
    })
  })
})
