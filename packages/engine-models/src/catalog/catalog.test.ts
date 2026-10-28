import { describe, expect, test } from 'bun:test'

import type { EngineCatalogStore } from '@localixai/agent/runtime'

import { createModelCatalog } from './catalog'
import { DOCUMENT_SCHEMA } from './normalize'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

const chat = (id: string) => ({
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
})

const catalogOf = (models: string[]) => ({
  openai: {
    id: 'openai',
    name: 'OpenAI',
    npm: '@ai-sdk/openai',
    env: ['OPENAI_API_KEY'],
    doc: 'https://docs',
    models: Object.fromEntries(models.map((id) => [id, chat(id)])),
  },
})

function memoryStore(initial: Record<string, unknown> = {}) {
  const entries = new Map(Object.entries(initial))
  const store: EngineCatalogStore = {
    read: async (key) => structuredClone(entries.get(key)),
    write: async (key, entry) => void entries.set(key, structuredClone(entry)),
    delete: async (key) => void entries.delete(key),
  }
  return { store, entries }
}

/** models.dev as a script: each request takes the next answer and is recorded. */
function scriptedFetch(answers: Array<{ status: number; body?: unknown; etag?: string } | Error>) {
  const requests: Array<{ url: string; etag: string | null }> = []
  const fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, etag: new Headers(init?.headers).get('if-none-match') })
    const answer = answers.shift()
    if (!answer) throw new Error('no more answers')
    if (answer instanceof Error) throw answer
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: answer.etag ? { etag: answer.etag } : {},
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests }
}

const network = { allowNetwork: true }

describe('the model catalog', () => {
  test('starts from the shipped snapshot and stores it, stale, so the first check fetches', async () => {
    const { store, entries } = memoryStore()
    const catalog = createModelCatalog({ store })
    const listed = await catalog.list()
    expect(listed.models.some((model) => model.id === 'openai/gpt-6-luna')).toBe(true)
    expect(entries.get('models.dev')).toMatchObject({ schema: DOCUMENT_SCHEMA, fetchedAt: 0 })
  })

  test('fetches conditionally: 304 and an identical catalog change nothing, a new one does', async () => {
    const { store, entries } = memoryStore()
    const { fetch, requests } = scriptedFetch([
      { status: 200, body: catalogOf(['a']), etag: 'W/"1"' },
      { status: 304 },
      { status: 200, body: catalogOf(['a']), etag: 'W/"2"' },
      { status: 200, body: catalogOf(['a', 'b']), etag: 'W/"3"' },
    ])
    const catalog = createModelCatalog({ store, fetch })

    expect(await catalog.refresh(network)).toEqual({ changed: true, aborted: false, errors: [] })
    expect((await catalog.list()).models.map((model) => model.id)).toContain('openai/a')
    expect(requests[0]).toEqual({ url: 'https://models.dev/api.json?type=all', etag: null })

    // Fresh: no request at all until forced.
    expect(await catalog.refresh(network)).toMatchObject({ changed: false })
    expect(requests).toHaveLength(1)

    expect(await catalog.refresh({ ...network, force: true })).toMatchObject({ changed: false })
    expect(requests[1]?.etag).toBe('W/"1"')
    expect(await catalog.refresh({ ...network, force: true })).toMatchObject({ changed: false })
    expect(await catalog.refresh({ ...network, force: true })).toMatchObject({ changed: true })
    expect((await catalog.list()).models.map((model) => model.id)).toContain('openai/b')
    expect(entries.get('models.dev')).toMatchObject({ etag: 'W/"3"' })
  })

  test('a failed check keeps the list it had and says why; an aborted one says only that', async () => {
    const { fetch } = scriptedFetch([
      { status: 200, body: catalogOf(['a']) },
      { status: 503 },
      { status: 200, body: 'not a catalog' },
    ])
    const catalog = createModelCatalog({ fetch })
    await catalog.refresh(network)
    expect(await catalog.refresh({ ...network, force: true })).toMatchObject({
      changed: false,
      errors: [{ message: 'models.dev answered 503' }],
    })
    expect(await catalog.refresh({ ...network, force: true })).toMatchObject({
      errors: [{ message: expect.stringContaining('not its catalog') }],
    })
    expect((await catalog.list()).models.map((model) => model.id)).toContain('openai/a')

    const controller = new AbortController()
    controller.abort()
    const aborting = createModelCatalog({ fetch: scriptedFetch([new Error('aborted')]).fetch })
    expect(await aborting.refresh({ ...network, signal: controller.signal })).toEqual({
      changed: false,
      aborted: true,
      errors: [],
    })
  })

  test('restores its stored copy across launches, and drops one of an older format', async () => {
    const { store } = memoryStore()
    await createModelCatalog({
      store,
      fetch: scriptedFetch([{ status: 200, body: catalogOf(['kept']) }]).fetch,
    }).refresh(network)
    const relaunched = createModelCatalog({ store })
    expect((await relaunched.list()).models.map((model) => model.id)).toEqual(['openai/kept'])

    const dropped: string[] = []
    const old = memoryStore({ 'models.dev': { schema: 1, fetchedAt: 1, document: {} } })
    await createModelCatalog({
      store: old.store,
      onDropped: (_key, reason) => dropped.push(reason),
    }).list()
    expect(dropped).toEqual(['an older format'])
  })

  test('resolves a chat model and a decision model of the same id by what the caller asks for', async () => {
    const catalog = createModelCatalog()
    const ref = { providerId: 'openai', modelId: 'gpt-6-luna' }
    expect(await catalog.resolve(ref)).toMatchObject({
      model: { kind: 'chat', api: 'openai-responses' },
    })
    expect(await catalog.resolve(ref, 'decision')).toMatchObject({
      model: { kind: 'decision', api: 'decisions' },
    })
    expect(
      await catalog.resolve({ providerId: 'openai', modelId: 'no-such-model' }),
    ).toBeUndefined()
  })

  test('one check is shared by every caller, and one caller giving up does not stop it for the rest', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let requests = 0
    const fetch = (async () => {
      requests++
      await gate
      return new Response(JSON.stringify(catalogOf(['a', 'b'])), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const catalog = createModelCatalog({ fetch })
    await catalog.list()
    const controller = new AbortController()
    const first = catalog.refresh({ ...network, force: true, signal: controller.signal })
    const second = catalog.refresh({ ...network, force: true })
    await turns()
    controller.abort()
    expect(await first).toEqual({ changed: false, aborted: true, errors: [] })
    release()
    expect(await second).toMatchObject({ changed: true, aborted: false })
    expect(requests).toBe(1)
    expect((await catalog.list()).models.map((model) => model.id)).toContain('openai/b')
  })
})
