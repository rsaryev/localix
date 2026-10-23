import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppFiles } from './archive'
import { __resetBundledSyncCache } from './bundled-install'
import { createMiniAppStore, type MiniAppStoreSource } from './store'

const root = tempDirPerTest('mini-app-store-media-')
const CATALOG = 'https://catalog.example.test/apps/mini-app-catalog.json'
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect/></svg>'
const encoder = new TextEncoder()

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
const pin = (url: string, bytes: Uint8Array, type?: string) => ({
  url,
  bytes: bytes.byteLength,
  sha256: sha(bytes),
  ...(type ? { type } : {}),
})

/** A hosted catalog with one app and its media, counting what is fetched. */
async function hosted(opts: { badShot?: boolean; featured?: boolean } = {}) {
  const shot = png(4800, 3000)
  const icon = encoder.encode(ICON)
  const readme = encoder.encode('# Chess\n\nPlay a game. <script>x</script>')
  const archive = await packMiniAppFiles({
    'mini-app.json': JSON.stringify({ name: 'chess', version: '1.0.0' }),
  })
  const files: Record<string, Uint8Array> = {
    'chess-icon.svg': icon,
    'chess-1.png': shot,
    'chess-readme.md': readme,
    'chess.tar.gz': archive,
  }
  const fetched: string[] = []
  const app = {
    name: 'chess',
    displayName: 'Chess',
    description: 'Play chess',
    category: 'games',
    version: '1.0.0',
    apiVersion: 1,
    publisher: { name: 'Localix', verified: true },
    icon: pin('chess-icon.svg', icon, 'image/svg+xml'),
    screenshots: [
      {
        ...pin('chess-1.png', opts.badShot ? png(1, 1) : shot, 'image/png'),
        caption: 'A position',
      },
    ],
    readme: pin('chess-readme.md', readme),
    tags: ['game', 'board-game'],
    license: 'MIT',
    author: 'Ada',
    homepage: 'https://example.test/chess',
    surfaces: ['agent', 'workbench'],
    commands: ['new', 'resign'],
    featured: opts.featured ?? true,
    archive: pin('chess.tar.gz', archive),
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    fetched.push(url)
    if (url === CATALOG) return Response.json({ schema: 1, apps: [app] })
    const body = files[url.split('/').pop() ?? '']
    return body
      ? new Response(new Blob([body as Uint8Array<ArrayBuffer>]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
  return { fetchImpl, fetched, shot }
}

function storeOver(sources: MiniAppStoreSource[], fetchImpl?: typeof fetch) {
  return createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => sources,
    onInstalled: async () => {},
    fetchImpl,
  })
}

async function localApp(source: string, manifest: Record<string, unknown>) {
  const dir = join(source, 'notes')
  await fs.mkdir(join(dir, 'screenshots'), { recursive: true })
  await fs.writeFile(
    join(dir, 'mini-app.json'),
    JSON.stringify({ name: 'notes', version: '0.2.0', description: 'Notes', ...manifest }),
  )
  await fs.writeFile(join(dir, 'icon.svg'), ICON)
  await fs.writeFile(join(dir, 'screenshots', 'main.png'), png(1600, 1000))
  await fs.writeFile(join(dir, 'README.md'), '# Notes')
  return dir
}

afterEach(() => __resetBundledSyncCache())

describe('the store lists each app with its icon and tags as host addresses', () => {
  test('a catalog app: its media through the host, never the catalog address', async () => {
    const { fetchImpl } = await hosted()
    const store = storeOver([{ kind: 'catalog', url: CATALOG, vouches: true }], fetchImpl)
    const [chess] = (await store.list()).entries
    expect(chess).toMatchObject({
      tags: ['game', 'board-game'],
      featured: true,
      source: CATALOG,
      icon: expect.stringMatching(/^\/rpc\/mini-apps\/store\/media\/chess\/icon\?v=[a-f0-9]{12}$/),
    })
    expect(JSON.stringify(chess)).not.toContain('catalog.example.test/apps/chess')
  })

  test('featured counts only in a catalog Localix vouches for', async () => {
    const { fetchImpl } = await hosted()
    const store = storeOver([{ kind: 'catalog', url: CATALOG, vouches: false }], fetchImpl)
    expect((await store.list()).entries[0]?.featured).toBeUndefined()
  })
})

describe('store media', () => {
  test('a catalog file is fetched once, checked against its pin, cached and served by type', async () => {
    const { fetchImpl, fetched, shot } = await hosted()
    const store = storeOver([{ kind: 'catalog', url: CATALOG, vouches: true }], fetchImpl)
    const first = await store.media('chess', 'screenshot', 0)
    expect(first.type).toBe('image/png')
    expect(first.bytes).toEqual(shot)
    await store.media('chess', 'screenshot', 0)
    expect(fetched.filter((url) => url.endsWith('chess-1.png'))).toHaveLength(1)
    expect((await store.media('chess', 'icon')).type).toBe('image/svg+xml')
  })

  test('a catalog file whose bytes differ from its pin is refused', async () => {
    const { fetchImpl } = await hosted({ badShot: true })
    const store = storeOver([{ kind: 'catalog', url: CATALOG, vouches: true }], fetchImpl)
    await expect(store.media('chess', 'screenshot', 0)).rejects.toThrow()
    await expect(store.media('chess', 'screenshot', 4)).rejects.toThrow(/no screenshot/i)
  })

  test('a local app is read from its own folder, and a path out of it is not served', async () => {
    const source = join(root(), 'staged')
    await localApp(source, { icon: './icon.svg', screenshots: [{ path: '../../secret.png' }] })
    const store = storeOver([
      { kind: 'local', root: source, publisher: { name: 'Localix', verified: true } },
    ])
    expect((await store.list()).entries[0]?.icon).toBe('/rpc/mini-apps/store/media/notes/icon')
    expect(new TextDecoder().decode((await store.media('notes', 'icon')).bytes)).toBe(ICON)
    await expect(store.media('notes', 'screenshot', 0)).rejects.toThrow()
  })
})

describe('the detail of one app', () => {
  test('says what it is and brings, with its README and screenshots as host addresses', async () => {
    const { fetchImpl } = await hosted()
    const store = storeOver([{ kind: 'catalog', url: CATALOG, vouches: true }], fetchImpl)
    const detail = await store.detail('chess')
    expect(detail.entry.name).toBe('chess')
    expect(detail.readme).toContain('# Chess')
    expect(detail.screenshots).toEqual([
      {
        url: expect.stringMatching(/^\/rpc\/mini-apps\/store\/media\/chess\/screenshot\/0\?v=/),
        caption: 'A position',
      },
    ])
    expect(detail.details).toMatchObject({
      version: '1.0.0',
      apiVersion: 1,
      size: expect.any(Number),
      license: 'MIT',
      author: 'Ada',
      homepage: 'https://example.test/chess',
      surfaces: ['agent', 'workbench'],
      commands: 2,
    })
  })

  test('a local app reads its README and manifest from its folder', async () => {
    const source = join(root(), 'staged')
    await localApp(source, {
      icon: './icon.svg',
      screenshots: [{ path: './screenshots/main.png', caption: 'Main' }],
      license: 'MIT',
      commands: { add: { prompt: 'Add a note' } },
    })
    const store = storeOver([
      { kind: 'local', root: source, publisher: { name: 'Localix', verified: true } },
    ])
    const detail = await store.detail('notes')
    expect(detail.readme).toBe('# Notes')
    expect(detail.screenshots).toEqual([
      { url: '/rpc/mini-apps/store/media/notes/screenshot/0', caption: 'Main' },
    ])
    expect(detail.details).toMatchObject({ version: '0.2.0', license: 'MIT', commands: 1 })
    await expect(store.detail('ghost')).rejects.toThrow(/ghost/)
  })
})
