import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppCatalog } from './mini-app-catalog.mjs'

const root = tempDirPerTest('mini-app-catalog-')

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect/></svg>'

/** A PNG header of the given size: all the pack step reads of a screenshot. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function stagedApp(staged: string, name: string, manifest: Record<string, unknown> = {}) {
  const dir = join(staged, name)
  mkdirSync(join(dir, 'backend'), { recursive: true })
  writeFileSync(
    join(dir, 'mini-app.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      description: `${name} app`,
      icon: './icon.svg',
      ...manifest,
    }),
  )
  writeFileSync(join(dir, 'icon.svg'), ICON)
  writeFileSync(join(dir, 'backend', 'index.mjs'), `export const name = '${name}'`)
  return dir
}

const sha = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

describe('packing the staged mini apps into a catalog', () => {
  test('writes one archive per app and a catalog that pins each by size and sha256', async () => {
    const staged = join(root(), 'staged')
    const out = join(root(), 'out')
    stagedApp(staged, 'chess', { displayName: 'Chess', category: 'games', apiVersion: 1 })
    stagedApp(staged, 'template', { private: true })
    mkdirSync(join(staged, 'not-an-app'), { recursive: true })

    const catalog = await packMiniAppCatalog({ stagedRoot: staged, outDir: out })

    expect(catalog.schema).toBe(1)
    expect(catalog.apps.map((app: { name: string }) => app.name)).toEqual(['chess'])
    const [chess] = catalog.apps
    expect(chess).toMatchObject({
      name: 'chess',
      displayName: 'Chess',
      category: 'games',
      version: '1.0.0',
      apiVersion: 1,
      publisher: { name: 'Localix', verified: true },
    })
    const bytes = new Uint8Array(readFileSync(join(out, chess.archive.url)))
    expect(chess.archive.bytes).toBe(bytes.byteLength)
    expect(chess.archive.sha256).toBe(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'))
    expect(JSON.parse(readFileSync(join(out, 'mini-app-catalog.json'), 'utf8'))).toEqual(catalog)

    const files = await new Bun.Archive(bytes).files()
    expect([...files.keys()].sort()).toEqual(['backend/index.mjs', 'icon.svg', 'mini-app.json'])
  })

  test('publishes the icon, screenshots and README beside the archive, each pinned by its hash', async () => {
    const staged = join(root(), 'staged')
    const out = join(root(), 'out')
    const dir = stagedApp(staged, 'chess', {
      tags: ['game', 'board-game'],
      homepage: 'https://example.com/chess',
      license: 'MIT',
      author: { name: 'Ada' },
      surfaces: ['agent', 'workbench'],
      commands: { new: { prompt: 'New game' } },
      screenshots: [{ path: './screenshots/board.png', caption: 'A position' }],
    })
    mkdirSync(join(dir, 'screenshots'))
    writeFileSync(join(dir, 'screenshots', 'board.png'), png(4800, 3000))
    writeFileSync(join(dir, 'README.md'), '# Chess\n')

    const { apps } = await packMiniAppCatalog({
      stagedRoot: staged,
      outDir: out,
      featured: ['chess'],
    })
    const [chess] = apps
    expect(chess).toMatchObject({
      tags: ['game', 'board-game'],
      homepage: 'https://example.com/chess',
      license: 'MIT',
      author: 'Ada',
      featured: true,
      surfaces: ['agent', 'workbench'],
      commands: ['new'],
      icon: { type: 'image/svg+xml', bytes: ICON.length },
      screenshots: [{ type: 'image/png', caption: 'A position' }],
      readme: { bytes: 8 },
    })
    for (const media of [chess.icon, chess.screenshots[0], chess.readme]) {
      const bytes = new Uint8Array(readFileSync(join(out, media.url)))
      expect(media.sha256).toBe(sha(bytes))
      expect(media.url).toContain(media.sha256.slice(0, 12))
    }
    // Screenshots are published beside the archive, never downloaded with the app.
    const files = await new Bun.Archive(readFileSync(join(out, chess.archive.url))).files()
    expect([...files.keys()]).not.toContain('screenshots/board.png')
  })

  test('refuses to pack an app whose icon is missing or not a valid icon', async () => {
    const staged = join(root(), 'staged')
    stagedApp(staged, 'timer', { icon: undefined })
    await expect(
      packMiniAppCatalog({ stagedRoot: staged, outDir: join(root(), 'out') }),
    ).rejects.toThrow('timer: mini-app.json declares no "icon"')

    const other = join(root(), 'other')
    const dir = stagedApp(other, 'notes')
    writeFileSync(join(dir, 'icon.svg'), 'not an svg')
    await expect(
      packMiniAppCatalog({ stagedRoot: other, outDir: join(root(), 'out') }),
    ).rejects.toThrow('notes: The icon ./icon.svg is not a .svg file')
  })

  test('an app the staging could not build is left out, and so is one asked not to be', async () => {
    const staged = join(root(), 'staged')
    stagedApp(staged, 'chess')
    stagedApp(staged, 'notes')
    stagedApp(staged, 'radio')
    const catalog = await packMiniAppCatalog({
      stagedRoot: staged,
      outDir: join(root(), 'out'),
      unavailable: { notes: 'backend did not build' },
      only: ['chess', 'notes'],
    })
    expect(catalog.apps.map((app: { name: string }) => app.name)).toEqual(['chess'])
  })
  test('a folder installed or checked out leaves its records, caches and dependencies behind', async () => {
    const source = join(root(), 'mine')
    stagedApp(source, 'notes')
    const dir = join(source, 'notes')
    writeFileSync(join(dir, '.localix-install.json'), '{}')
    writeFileSync(join(dir, '.localix-managed.json'), '{}')
    mkdirSync(join(dir, 'node_modules', 'zod'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'zod', 'index.js'), '')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), '')
    const out = join(root(), 'out')
    const catalog = await packMiniAppCatalog({
      stagedRoot: source,
      outDir: out,
      publisher: { name: 'Someone', verified: false },
    })
    expect(catalog.apps[0].publisher).toEqual({ name: 'Someone', verified: false })
    const files = await new Bun.Archive(
      readFileSync(join(out, catalog.apps[0].archive.url)),
    ).files()
    expect([...files.keys()].sort()).toEqual(['backend/index.mjs', 'icon.svg', 'mini-app.json'])
  })
})
