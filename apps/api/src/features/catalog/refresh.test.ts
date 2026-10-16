import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  EngineCatalogRefreshOptions,
  EngineCatalogRefreshResult,
} from '@localixai/agent/runtime'

import type { CatalogResponse } from './contracts'
import { createModelCatalogStore } from './models-store'
import {
  armModelCatalogChecks,
  logCatalogRefresh,
  modelCatalogRefreshEnabled,
} from './refresh-schedule'
import { createCatalogRoutes } from './routes'
import { createCatalogService } from './service'

const catalogNamed = (...names: string[]): CatalogResponse => ({
  providers: [{ id: 'p', name: 'P', modelCount: names.length, authType: 'api-key' }],
  models: names.map((name) => ({
    id: `p/${name}`,
    name,
    providerId: 'p',
    providerName: 'P',
    supportsTools: true,
    supportsReasoning: false,
    supportsAttachment: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
  })),
  oauthProviderIds: [],
  oauthProviders: [],
})

const ok = (changed: boolean): EngineCatalogRefreshResult => ({
  changed,
  aborted: false,
  errors: [],
})

/** A source whose list changes when a refresh publishes, like the adapter's. */
function refreshingSource(
  outcome: (options: EngineCatalogRefreshOptions) => {
    result: EngineCatalogRefreshResult
    publish?: string[]
  },
) {
  let names = ['baseline']
  const calls: EngineCatalogRefreshOptions[] = []
  let lists = 0
  return {
    calls,
    lists: () => lists,
    source: {
      list: () => {
        lists += 1
        return catalogNamed(...names)
      },
      refresh: async (options: EngineCatalogRefreshOptions) => {
        calls.push(options)
        await Promise.resolve()
        const { result, publish } = outcome(options)
        if (publish) names = publish
        return result
      },
    },
  }
}

const modelNames = async (service: ReturnType<typeof createCatalogService>) =>
  (await service.getCatalog()).models.map((model) => model.name)

describe('catalog refresh', () => {
  test('reads wait for the startup restore, which runs once and offline', async () => {
    const { source, calls } = refreshingSource(() => ({ result: ok(true), publish: ['restored'] }))
    const service = createCatalogService({ source })

    void service.restore()
    void service.restore()
    service.warm()

    expect(await modelNames(service)).toEqual(['restored'])
    expect(calls).toEqual([{ allowNetwork: false }])
  })

  test('a check that publishes invalidates the cached build; one that does not keeps it', async () => {
    let publish: string[] | undefined
    const { source, calls, lists } = refreshingSource(() => ({
      result: ok(publish !== undefined),
      publish,
    }))
    const service = createCatalogService({ source })
    expect(await modelNames(service)).toEqual(['baseline'])

    expect(await service.check()).toEqual({ ok: true, changed: false, failedProviders: [] })
    expect(await modelNames(service)).toEqual(['baseline'])
    expect(lists()).toBe(1)

    publish = ['baseline', 'new-model']
    expect((await service.check({ force: true })).changed).toBe(true)
    expect(await modelNames(service)).toEqual(['baseline', 'new-model'])
    expect(calls.at(-1)).toEqual({ allowNetwork: true, force: true })
  })

  test('a failed check keeps the list and reports each provider with one message per cause', async () => {
    const { source } = refreshingSource(() => ({
      result: {
        changed: false,
        aborted: false,
        errors: [
          { providerId: 'openai', message: 'models.dev API returned 503' },
          { providerId: 'anthropic', message: 'models.dev API returned 503' },
        ],
      },
    }))
    const service = createCatalogService({ source })
    const before = await modelNames(service)

    expect(await service.check()).toEqual({
      ok: false,
      changed: false,
      failedProviders: ['openai', 'anthropic'],
      message: 'models.dev API returned 503',
    })
    expect(await modelNames(service)).toEqual(before)
  })

  test('concurrent checks share one run', async () => {
    const { source, calls } = refreshingSource(() => ({ result: ok(false) }))
    const service = createCatalogService({ source })
    const [a, b] = await Promise.all([service.check(), service.check()])
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
  })

  test('a fixed catalog has nothing to refresh', async () => {
    const service = createCatalogService({ source: { list: () => catalogNamed('fixed') } })
    await service.restore()
    expect(await service.check()).toEqual({ ok: true, changed: false, failedProviders: [] })
  })

  test('POST /refresh checks now, past the freshness window', async () => {
    const seen: unknown[] = []
    const app = createCatalogRoutes({
      getCatalog: async () => catalogNamed('m'),
      check: async (options) => {
        seen.push(options)
        return { ok: true, changed: true, failedProviders: [] }
      },
    })
    const response = await app.request('/refresh', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, changed: true, failedProviders: [] })
    expect(seen).toEqual([{ force: true }])
  })

  test('LOCALIX_MODEL_CATALOG_REFRESH=0 turns the automatic checks off', () => {
    expect(modelCatalogRefreshEnabled({})).toBe(true)
    expect(modelCatalogRefreshEnabled({ LOCALIX_MODEL_CATALOG_REFRESH: '0' })).toBe(false)
    expect(modelCatalogRefreshEnabled({ LOCALIX_MODEL_CATALOG_REFRESH: 'off' })).toBe(false)
    const logger = { info: () => {}, warn: () => {} }
    const catalogService = {
      check: async () => ({ ok: true, changed: false, failedProviders: [] }),
    }
    expect(
      armModelCatalogChecks({
        catalogService,
        logger,
        signal: new AbortController().signal,
        source: { LOCALIX_MODEL_CATALOG_REFRESH: '0' },
      }),
    ).toBeUndefined()
  })

  test('a refresh with failed providers is logged once per cause, as a warning', () => {
    const lines: { level: string; detail: Record<string, unknown> }[] = []
    const log = logCatalogRefresh({
      info: (detail) => lines.push({ level: 'info', detail }),
      warn: (detail) => lines.push({ level: 'warn', detail }),
    })
    log(
      {
        changed: false,
        aborted: false,
        errors: [
          { providerId: 'a', message: 'offline' },
          { providerId: 'b', message: 'offline' },
        ],
      },
      { allowNetwork: true },
    )
    log(ok(true), { allowNetwork: false })
    expect(lines).toEqual([
      {
        level: 'warn',
        detail: {
          event: 'catalog.refreshed',
          network: true,
          changed: false,
          failed: 2,
          errors: ['offline'],
        },
      },
      {
        level: 'info',
        detail: { event: 'catalog.refreshed', network: false, changed: true, failed: 0 },
      },
    ])
  })
})

describe('model catalog store', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })
  const tempStore = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'localix-model-catalog-'))
    dirs.push(dir)
    return { dir, store: createModelCatalogStore(join(dir, 'model-catalog')) }
  }

  test('round-trips one file per provider and deletes it', async () => {
    const { dir, store } = await tempStore()
    expect(await store.read('openai')).toBeUndefined()

    await store.write('openai', { build: 'b', entry: { models: [] } })
    expect(await store.read('openai')).toEqual({ build: 'b', entry: { models: [] } })
    expect(JSON.parse(await readFile(join(dir, 'model-catalog', 'openai.json'), 'utf8'))).toEqual({
      build: 'b',
      entry: { models: [] },
    })

    await store.delete('openai')
    expect(await store.read('openai')).toBeUndefined()
  })

  test('a file that is not JSON throws, for the adapter to drop', async () => {
    const { dir, store } = await tempStore()
    await store.write('openai', {})
    await writeFile(join(dir, 'model-catalog', 'openai.json'), '{"trunc')
    await expect(store.read('openai')).rejects.toThrow()
  })

  test('refuses a provider id that is not a slug', async () => {
    const { store } = await tempStore()
    await expect(store.write('../escape', {})).rejects.toThrow('Invalid provider id')
    await expect(store.read('a/b')).rejects.toThrow('Invalid provider id')
  })
})
