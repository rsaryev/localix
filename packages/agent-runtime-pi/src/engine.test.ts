import { describe, expect, test } from 'bun:test'

import { createPiEngine } from './engine'

describe('the pi engine — one adapter, every port', () => {
  test('carries the adapter identity the runtime persists with each run', () => {
    const engine = createPiEngine()
    expect(engine.id).toBe('pi')
    expect(engine.version).toBe(engine.runtime.adapter.version)
    expect(engine.version.length).toBeGreaterThan(0)
  })

  test('exposes each port as a distinct object with the neutral shape', () => {
    const engine = createPiEngine({ maxRetries: 1, maxRetryDelayMs: 10, timeoutMs: 1_000 })
    expect(typeof engine.runtime.run).toBe('function')
    expect(typeof engine.runtime.disposeSession).toBe('function')
    expect(typeof engine.languageModels.create).toBe('function')
    expect(typeof engine.createAuth).toBe('function')
    expect(typeof engine.listCatalog).toBe('function')
    expect(typeof engine.refreshCatalog).toBe('function')
  })

  test('the catalog lists providers and models with the OAuth metadata the contract wants', async () => {
    // No catalog store and no refresh: the generated catalog, nothing fetched or persisted.
    const catalog = await createPiEngine().listCatalog()
    expect(catalog.providers.length).toBeGreaterThan(0)
    expect(catalog.models.length).toBeGreaterThan(0)
    // Chat models write text and decision models answer typed questions; pi's image models
    // are not listed, since nothing in Localix drives them any more.
    for (const model of catalog.models)
      expect(model.outputModalities).toEqual(model.kind === 'decision' ? ['decisions'] : ['text'])
    expect(Array.isArray(catalog.oauthProviderIds)).toBe(true)
    expect(Array.isArray(catalog.oauthProviders)).toBe(true)
    for (const provider of catalog.oauthProviders) {
      expect(catalog.oauthProviderIds).toContain(provider.providerId)
    }
  })
})
