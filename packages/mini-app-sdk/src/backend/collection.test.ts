import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { MiniAppContext } from './context'
import type { MiniAppRouteScope } from './http'
import type { SemanticIndexHost, SemanticSource } from './semantic'
import { createMiniApp } from './app'
import { defineCollection, type Collection } from './collection'

const roots: string[] = []
beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Let pending promise work land, then let the store feed's coalescing window close. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  jest.advanceTimersByTime(200)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const entryInput = z.object({
  title: z.string().trim().min(1, 'Name the entry.'),
  amount: z.number().nonnegative(),
})
const entry = entryInput.extend({ id: z.string(), at: z.string() })

type Entries = Collection<z.infer<typeof entry>, typeof entryInput.shape>

const entries = defineCollection({
  name: 'entries',
  item: entry,
  input: entryInput,
  create: (input, { id, now }) => ({ ...input, id, at: now.toISOString() }),
})

function fakeContext(overrides: Partial<MiniAppContext> = {}): MiniAppContext {
  const root = mkdtempSync(join(tmpdir(), 'collection-'))
  roots.push(root)
  return {
    miniAppName: 'diary',
    userId: 'me',
    dataDir: join(root, 'app'),
    sessionStorage: {
      resolveDataDir: async (_userId, sessionId) => join(root, 'chats', sessionId),
    },
    ...overrides,
  } as MiniAppContext
}

function serve(ctx: MiniAppContext, register: (app: ReturnType<typeof createMiniApp>) => void) {
  const app = createMiniApp(ctx)
  register(app)
  const registration = app.registration()
  const backend = registration.backend![0]!
  const scope = (sessionId?: string): MiniAppRouteScope => ({
    userId: 'me',
    projectId: '',
    cwd: '/',
    ...(sessionId ? { sessionId } : {}),
  })
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    sessionId?: string,
  ): Promise<{ status: number; json: any }> => {
    const response = await backend.routeMount!.app.request(
      path,
      {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      },
      scope(sessionId),
    )
    return { status: response.status, json: await response.json() }
  }
  return { registration, backend, request }
}

describe('a collection', () => {
  test('what the agent adds the view reads, and what the view adds the agent lists', async () => {
    const ctx = fakeContext()
    let diary!: Entries
    const { request, backend } = serve(ctx, (app) => {
      diary = app.collection(entries)
    })
    expect(backend.routeMount!.path).toBe('/rpc/diary')

    // The agent's tool writes through the collection…
    const logged = await diary.add({ title: 'Oatmeal', amount: 320 })
    expect(logged).toMatchObject({ title: 'Oatmeal', amount: 320 })
    // …and the view reads it from the route.
    expect((await request('GET', '/entries')).json.items).toEqual([logged])

    // The view adds one; the answer is the new list, so it shows it without a second read.
    const added = await request('POST', '/entries', { title: 'Apple', amount: 95 })
    expect(added.status).toBe(200)
    expect(added.json.items.map((item: { title: string }) => item.title)).toEqual([
      'Oatmeal',
      'Apple',
    ])
    expect((await diary.list()).map((item) => item.title)).toEqual(['Oatmeal', 'Apple'])
  })

  test('changes and removes one item by its id, and says when the id is unknown', async () => {
    const ctx = fakeContext()
    let diary!: Entries
    const { request } = serve(ctx, (app) => {
      diary = app.collection(entries)
    })
    const { id } = await diary.add({ title: 'Toast', amount: 200 })

    const changed = await request('PATCH', `/entries/${id}`, { amount: 150 })
    expect(changed.json.items).toEqual([
      expect.objectContaining({ id, title: 'Toast', amount: 150 }),
    ])

    expect((await request('DELETE', `/entries/${id}`)).json.items).toEqual([])
    const missing = await request('DELETE', `/entries/${id}`)
    expect(missing.status).toBe(404)
    expect(missing.json.error.message).toBe('That item is gone.')
    expect(await diary.update(id, { amount: 1 })).toBeNull()
  })

  test('refuses input that breaks its schema with the reason, and stores nothing', async () => {
    const { request } = serve(fakeContext(), (app) => {
      app.collection(entries)
    })

    const refused = await request('POST', '/entries', { title: ' ', amount: 10 })

    expect(refused.status).toBe(400)
    expect(refused.json.error.message).toContain('Name the entry.')
    expect((await request('GET', '/entries')).json.items).toEqual([])
  })

  test('keeps the newest items up to its limit', async () => {
    let diary!: Entries
    serve(fakeContext(), (app) => {
      diary = app.collection(defineCollection({ ...entries, limit: 2 }))
    })
    for (const title of ['a', 'b', 'c']) await diary.add({ title, amount: 1 })

    expect((await diary.list()).map((item) => item.title)).toEqual(['b', 'c'])
  })

  test("in a chat's scope, each chat has its own items and a request outside a chat is refused", async () => {
    let board!: Entries
    const { request } = serve(fakeContext(), (app) => {
      board = app.collection(defineCollection({ ...entries, scope: 'chat' }))
    })

    await board.add({ title: 'in chat A', amount: 1 }, { sessionId: 'chat-a' })
    await request('POST', '/entries', { title: 'in chat B', amount: 2 }, 'chat-b')

    const titles = async (sessionId: string) =>
      (await request('GET', '/entries', undefined, sessionId)).json.items.map(
        (item: { title: string }) => item.title,
      )
    expect(await titles('chat-a')).toEqual(['in chat A'])
    expect(await titles('chat-b')).toEqual(['in chat B'])
    const outside = await request('GET', '/entries')
    expect(outside.status).toBe(400)
    expect(outside.json.error.message).toBe('Open this in a chat.')
    await expect(board.list()).rejects.toThrow('needs the chat')
  })

  test('an open view hears every write, the agent’s included', async () => {
    let diary!: Entries
    const { backend } = serve(fakeContext(), (app) => {
      diary = app.collection(entries)
    })
    const frames: string[] = []
    const feed = backend.wsFrames![0]!
    const handle = feed.start({}, (frame: string) => frames.push(frame), { userId: 'me' } as never)
    await settle()
    frames.length = 0

    await diary.add({ title: 'Soup', amount: 180 })
    await settle()

    expect(frames.map((frame) => JSON.parse(frame))).toEqual([
      { miniApp: 'diary', sessionId: null },
    ])
    feed.stop(handle)
  })

  test('finds items by meaning when the host can embed, and by nothing before', async () => {
    const sources: SemanticSource[] = []
    const changed: string[][] = []
    let ready = false
    const semantic = {
      registerSource: (source: SemanticSource) => {
        sources.push(source)
        return () => {}
      },
      changed: (_collection: string, keys: readonly string[]) => changed.push([...keys]),
      query: async (_userId: string, _collection: string, text: string) =>
        ready
          ? (await sources[0]!.scan(null, 10)).items
              .filter((item) => item.text.includes(text))
              .map((item) => ({
                key: item.key,
                chunk: 0,
                excerpt: item.text,
                z: 3,
                gate: 2,
                cosine: 0.9,
                scope: null,
              }))
          : [],
    } as unknown as SemanticIndexHost
    let diary!: Entries
    serve(fakeContext({ host: { semantic } as MiniAppContext['host'] }), (app) => {
      diary = app.collection(defineCollection({ ...entries, search: (item) => item.title }))
    })
    const soup = await diary.add({ title: 'Tomato soup', amount: 180 })
    await diary.add({ title: 'Toast', amount: 200 })

    expect(sources[0]!.collection).toBe('entries')
    expect(await sources[0]!.read([soup.id])).toEqual([
      expect.objectContaining({ key: soup.id, userId: 'me', text: 'Tomato soup' }),
    ])
    expect(changed).toEqual([[soup.id], [expect.any(String)]])
    expect(await diary.search('soup')).toEqual([])
    ready = true
    expect(await diary.search('soup')).toEqual([soup])
  })
})
