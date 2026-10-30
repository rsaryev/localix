import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { hostedMiniAppCatalog } from '../../testing/mini-app-catalog'
import { createMiniAppStore, type MiniAppStoreSource } from './store'

// Localix Community is a list: each mini app in it is a link to its author's own catalog, which
// says what the app is and signs it (or not) with the author's own key. Localix vouches for none
// of it, and its own catalog keeps its names.

const root = tempDirPerTest('mini-app-store-community-')
const LOCALIX = 'https://localix.example.test/mini-app-catalog.json'
const LIST = 'https://community.example.test/.mini-app/marketplace.json'
const ADA = 'https://ada.example.test/releases/latest/download/mini-app-catalog.json'
const OTHER = 'https://other.example.test/mini-app-catalog.json'

const keptKey = (pair: { publicKey: KeyObject }) =>
  Buffer.from(pair.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64')

function community(links: Record<string, unknown>[]) {
  const list = {
    schema: 2,
    name: 'localix-community',
    owner: { name: 'Localix Community' },
    apps: links,
  }
  return (async () => new Response(JSON.stringify(list))) as unknown as typeof fetch
}

function setup(opts: { links: Record<string, unknown>[]; key?: KeyObject; added?: boolean }) {
  const localix = hostedMiniAppCatalog([{ name: 'atlas', version: '1.0.0' }], { url: LOCALIX })
  const ada = hostedMiniAppCatalog(
    [
      { name: 'habits', version: '1.0.0', verified: false, description: 'Ada’s habits' },
      { name: 'atlas', version: '9.0.0', verified: false },
      { name: 'notes', version: '1.0.0', verified: false, description: '' },
    ],
    { url: ADA, ...(opts.key ? { signWith: opts.key } : {}) },
  )
  const otherKey = generateKeyPairSync('ed25519')
  const other = hostedMiniAppCatalog([{ name: 'habits', version: '2.0.0', verified: false }], {
    url: OTHER,
    signWith: otherKey.privateKey,
  })
  const list = { links: opts.links }
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith(LIST)) {
      if (url.endsWith('.sig')) return new Response('missing', { status: 404 })
      return community(list.links)(url, init)
    }
    const host = new URL(url).host
    if (host === new URL(LOCALIX).host) return localix.fetchImpl(url, init)
    if (host === new URL(OTHER).host) return other.fetchImpl(url, init)
    return ada.fetchImpl(url, init)
  }) as unknown as typeof fetch
  const keys = new Map<string, string>()
  const sources = (): MiniAppStoreSource[] => [
    { kind: 'catalog', url: LOCALIX, vouches: true },
    { kind: 'catalog', url: LIST, vouches: false },
    ...(opts.added
      ? [{ kind: 'catalog' as const, url: OTHER, vouches: false, key: keptKey(otherKey) }]
      : []),
  ]
  const home = join(root(), 'home')
  const store = createMiniAppStore({
    homeDir: home,
    sources,
    onInstalled: async () => {},
    fetchImpl,
    linkedKeys: {
      get: async (url) => keys.get(url),
      pin: async (url, key) => void (keys.has(url) || keys.set(url, key)),
    },
  })
  return { store, keys, ada, list, home }
}

describe('a mini app Localix Community links to', () => {
  test('is its author’s, read from the author’s catalog and offered under the list', async () => {
    const author = generateKeyPairSync('ed25519')
    const { store, keys } = setup({
      key: author.privateKey,
      links: [
        { name: 'habits', description: 'The list’s words', source: { source: 'url', url: ADA } },
        {
          name: 'notes',
          description: 'Notes, as the list says',
          category: 'utilities',
          source: { source: 'url', url: ADA },
        },
      ],
    })
    const { entries } = await store.list()
    const habits = entries.find((entry) => entry.name === 'habits')
    expect(habits).toMatchObject({
      version: '1.0.0',
      // The author's catalog is the authority on what the app is.
      description: 'Ada’s habits',
      publisher: { name: 'Someone', verified: false },
      source: LIST,
      signature: 'signed',
    })
    // The list fills in only what the author's catalog leaves out.
    expect(entries.find((entry) => entry.name === 'notes')).toMatchObject({
      description: 'Notes, as the list says',
      category: 'utilities',
    })
    // The author's key is kept from its first signed read.
    expect(keys.get(ADA)).toBe(keptKey(author))
  })

  test('never takes a name the Localix catalog has, and links only the app it names', async () => {
    const { store } = setup({
      links: [
        { name: 'atlas', description: 'An impostor', source: { source: 'url', url: ADA } },
        { name: 'missing', description: 'Not there', source: { source: 'url', url: ADA } },
      ],
    })
    const { entries, problems } = await store.list()
    expect(entries.map((entry) => [entry.name, entry.version])).toEqual([['atlas', '1.0.0']])
    expect(problems.join('\n')).toContain('missing is not in its catalog')
  })

  test('an author catalog signed with another key installs nothing', async () => {
    const author = generateKeyPairSync('ed25519')
    const stranger = generateKeyPairSync('ed25519')
    const { store, ada } = setup({
      key: author.privateKey,
      links: [{ name: 'habits', description: 'Habits', source: { source: 'url', url: ADA } }],
    })
    await store.list()
    ada.signing.key = stranger.privateKey
    await store.refresh()
    const { entries } = await store.list()
    expect(entries.find((entry) => entry.name === 'habits')?.signature).toBe('mismatch')
    await expect(store.install('habits', { acceptUnverified: true })).rejects.toThrow(
      'signature changed',
    )
  })

  test('installs from the author’s catalog after a yes, and no other catalog updates it', async () => {
    const author = generateKeyPairSync('ed25519')
    const { store, list, home } = setup({
      key: author.privateKey,
      added: true,
      links: [{ name: 'habits', description: 'Habits', source: { source: 'url', url: ADA } }],
    })
    await expect(store.install('habits')).rejects.toThrow('unverified publisher')
    await store.install('habits', { acceptUnverified: true })
    await store.settled()
    const record = JSON.parse(
      await fs.readFile(
        join(home, '.localix', 'mini-apps', 'habits', '.localix-install.json'),
        'utf8',
      ),
    )
    expect(record.catalog).toBe(ADA)

    // The list drops it; a catalog the person added offers its own "habits", signed or not, at a
    // newer version, signed with the key kept for it. It is someone else's app, so it never
    // replaces Ada's.
    list.links = []
    await store.refresh()
    expect((await store.list()).entries.find((entry) => entry.name === 'habits')).toMatchObject({
      version: '2.0.0',
      signature: 'signed',
      // Not an update of the installed one, so the Store does not offer it as one.
      update: false,
    })
    expect(await store.updateInstalled()).toEqual([])
  })

  test('a GitHub repository stands for the catalog its latest release publishes', async () => {
    const asked: string[] = []
    const store = createMiniAppStore({
      homeDir: join(root(), 'home'),
      sources: () => [{ kind: 'catalog', url: LIST, vouches: false }],
      onInstalled: async () => {},
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        asked.push(url)
        if (url === LIST)
          return new Response(
            JSON.stringify({
              schema: 2,
              name: 'localix-community',
              owner: { name: 'Localix Community' },
              apps: [{ name: 'habits', source: { source: 'github', repo: 'ada/habits' } }],
            }),
          )
        return new Response('missing', { status: 404 })
      }) as unknown as typeof fetch,
    })
    await store.list()
    expect(asked).toContain(
      'https://github.com/ada/habits/releases/latest/download/mini-app-catalog.json',
    )
  })
})
