import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

import { memoryTrust } from '../../testing/mini-app-marketplace'
import { packMiniAppFiles } from './archive'
import { createMiniAppStore } from './store'

const root = tempDirPerTest('mini-app-store-media-')
const MARKETPLACE = 'https://marketplace.example.test/apps/mini-app-marketplace.json'
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

/** A released marketplace with one app and its media, counting what is fetched. */
async function hosted(opts: { badShot?: boolean; featured?: boolean } = {}) {
  const shot = png(4800, 3000)
  const icon = encoder.encode(ICON)
  const readme = encoder.encode('# Atlas\n\nPlay a game. <script>x</script>')
  const archive = await packMiniAppFiles({
    [MINI_APP_MANIFEST_FILE]: JSON.stringify({ name: 'atlas', version: '1.0.0' }),
  })
  const files: Record<string, Uint8Array> = {
    'atlas-icon.svg': icon,
    'atlas-1.png': shot,
    'atlas-readme.md': readme,
    'atlas.tar.gz': archive,
  }
  const fetched: string[] = []
  const app = {
    name: 'atlas',
    displayName: 'Atlas',
    description: 'Play atlas',
    category: 'games',
    version: '1.0.0',
    apiVersion: 1,
    icon: pin('atlas-icon.svg', icon, 'image/svg+xml'),
    screenshots: [
      {
        ...pin('atlas-1.png', opts.badShot ? png(1, 1) : shot, 'image/png'),
        caption: 'A position',
      },
    ],
    readme: pin('atlas-readme.md', readme),
    tags: ['game', 'board-game'],
    license: 'MIT',
    author: 'Ada',
    homepage: 'https://example.test/atlas',
    surfaces: ['agent', 'workbench'],
    commands: ['new', 'resign'],
    featured: opts.featured ?? true,
    source: { source: 'archive', ...pin('atlas.tar.gz', archive) },
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    fetched.push(url)
    if (url === MARKETPLACE)
      return Response.json({ schema: 3, name: 'localix', owner: { name: 'Localix' }, apps: [app] })
    const body = files[url.split('/').pop() ?? '']
    return body
      ? new Response(new Blob([body as Uint8Array<ArrayBuffer>]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
  return { fetchImpl, fetched, shot }
}

function storeOver(vouches: boolean, fetchImpl?: typeof fetch) {
  return createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => [{ url: MARKETPLACE, name: 'localix', vouches, builtIn: vouches }],
    trust: memoryTrust(),
    onInstalled: async () => {},
    fetchImpl,
  })
}

describe('the store lists each app with its icon and tags as host addresses', () => {
  test('an app: its media through the host, by its identity, never the marketplace’s address', async () => {
    const { fetchImpl } = await hosted()
    const store = storeOver(true, fetchImpl)
    const [atlas] = (await store.list()).entries
    expect(atlas).toMatchObject({
      tags: ['game', 'board-game'],
      featured: true,
      source: MARKETPLACE,
      icon: expect.stringMatching(
        /^\/rpc\/mini-apps\/store\/media\/atlas%40localix\/icon\?v=[a-f0-9]{12}$/,
      ),
    })
    expect(JSON.stringify(atlas)).not.toContain('marketplace.example.test/apps/atlas')
  })

  test('featured counts only in a marketplace Localix vouches for', async () => {
    const { fetchImpl } = await hosted()
    const store = storeOver(false, fetchImpl)
    expect((await store.list()).entries[0]?.featured).toBeUndefined()
  })
})

describe('store media', () => {
  test('a pinned file is fetched once, checked against its pin, cached and served by type', async () => {
    const { fetchImpl, fetched, shot } = await hosted()
    const store = storeOver(true, fetchImpl)
    const first = await store.media('atlas', 'screenshot', 0)
    expect(first.type).toBe('image/png')
    expect(first.bytes).toEqual(shot)
    await store.media('atlas', 'screenshot', 0)
    expect(fetched.filter((url) => url.endsWith('atlas-1.png'))).toHaveLength(1)
    expect((await store.media('atlas', 'icon')).type).toBe('image/svg+xml')
  })

  test('a pinned file whose bytes differ from its pin is refused', async () => {
    const { fetchImpl } = await hosted({ badShot: true })
    const store = storeOver(true, fetchImpl)
    await expect(store.media('atlas', 'screenshot', 0)).rejects.toThrow()
    await expect(store.media('atlas', 'screenshot', 4)).rejects.toThrow(/no screenshot/i)
  })
})

describe('the detail of one app', () => {
  test('says what it is and brings, with its README and screenshots as host addresses', async () => {
    const { fetchImpl } = await hosted()
    const store = storeOver(true, fetchImpl)
    const detail = await store.detail('atlas')
    expect(detail.entry.name).toBe('atlas')
    expect(detail.readme).toContain('# Atlas')
    expect(detail.screenshots).toEqual([
      {
        url: expect.stringMatching(
          /^\/rpc\/mini-apps\/store\/media\/atlas%40localix\/screenshot\/0\?v=/,
        ),
        caption: 'A position',
      },
    ])
    expect(detail.details).toMatchObject({
      version: '1.0.0',
      apiVersion: 1,
      size: expect.any(Number),
      license: 'MIT',
      author: 'Ada',
      homepage: 'https://example.test/atlas',
      surfaces: ['agent', 'workbench'],
      commands: 2,
    })
    await expect(store.detail('ghost')).rejects.toThrow(/ghost/)
  })
})
