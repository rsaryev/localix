import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppCatalog } from './mini-app-catalog.mjs'

const root = tempDirPerTest('mini-app-catalog-')

function stagedApp(staged: string, name: string, manifest: Record<string, unknown> = {}) {
  const dir = join(staged, name)
  mkdirSync(join(dir, 'backend'), { recursive: true })
  writeFileSync(
    join(dir, 'mini-app.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} app`, ...manifest }),
  )
  writeFileSync(join(dir, 'backend', 'index.mjs'), `export const name = '${name}'`)
}

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
    expect([...files.keys()].sort()).toEqual(['backend/index.mjs', 'mini-app.json'])
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
    expect([...files.keys()].sort()).toEqual(['backend/index.mjs', 'mini-app.json'])
  })
})
