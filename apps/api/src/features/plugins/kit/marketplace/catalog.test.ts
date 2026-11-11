import { afterEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  catalogKnows,
  parseMarketplace,
  readMarketplace,
  relativeEntryPath,
  resolveEntryName,
} from './catalog'
import { resolveEntrySource } from './entry-source'

const owner = { name: 'o' }
const market = (plugins: unknown[], extra: Record<string, unknown> = {}) =>
  parseMarketplace({ name: 'shop', owner, plugins, ...extra })

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('readMarketplace', () => {
  it("reads Claude Code's .claude-plugin/marketplace.json and leaves a bad entry out", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'kit-catalog-'))
    dirs.push(dir)
    await fs.mkdir(join(dir, '.claude-plugin'))
    const plugins = [
      { name: 'good', source: './plugins/good' },
      { name: 'bad', source: '../escape' },
    ]
    await fs.writeFile(
      join(dir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: 'shop', owner, plugins }),
    )
    const read = await readMarketplace(dir)
    expect(read.plugins.map((one) => one.name)).toEqual(['good'])
    expect(relativeEntryPath(read.plugins[0]!)).toBe('plugins/good')
  })

  it('refuses a folder without the catalog, and a catalog that cannot load', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'kit-catalog-'))
    dirs.push(dir)
    await expect(readMarketplace(dir)).rejects.toThrow('No .claude-plugin/marketplace.json')
    expect(() => parseMarketplace({ plugins: [] })).toThrow('Invalid marketplace.json')
  })

  it('takes an official name only from a source under github.com/anthropics/', () => {
    const raw = { name: 'claude-plugins-official', owner, plugins: [] }
    expect(() => parseMarketplace(raw, { source: 'github', repo: 'someone/fork' })).toThrow(
      'reserved',
    )
    expect(
      parseMarketplace(raw, { source: 'github', repo: 'anthropics/claude-plugins-official' }).name,
    ).toBe('claude-plugins-official')
  })
})

describe('resolveEntryName', () => {
  const renamed = market([{ name: 'new', source: './new' }], {
    renames: { old: 'new', gone: null },
  })

  it('follows a rename, refuses a removed plugin, and passes a listed or unknown name', () => {
    expect(resolveEntryName(renamed, 'old')).toEqual({ name: 'new', renamedFrom: 'old' })
    expect(() => resolveEntryName(renamed, 'gone')).toThrow('was removed from marketplace "shop"')
    expect(resolveEntryName(renamed, 'new')).toEqual({ name: 'new' })
    expect(resolveEntryName(renamed, 'other')).toEqual({ name: 'other' })
    expect([catalogKnows(renamed, 'old'), catalogKnows(renamed, 'other')]).toEqual([true, false])
  })
})

describe('resolveEntrySource', () => {
  const entry = (source: unknown, extra: Record<string, unknown> = {}) =>
    market([{ name: 'p', source, ...extra }]).plugins[0]!

  it('resolves a relative folder, under metadata.pluginRoot for a bare name', () => {
    expect(resolveEntrySource('/m', entry('./plugins/p'))).toEqual({ localPath: '/m/plugins/p' })
    const bare = parseMarketplace({
      name: 'shop',
      owner,
      metadata: { pluginRoot: './plugins' },
      plugins: [{ name: 'p', source: 'p' }],
    }).plugins[0]!
    expect(resolveEntrySource('/m', bare)).toEqual({ localPath: '/m/plugins/p' })
  })

  it('plans git, npm and archive sources, a pinned commit over its ref', () => {
    const sha = 'a'.repeat(40)
    expect(
      resolveEntrySource('/m', entry({ source: 'github', repo: 'o/r', ref: 'v1', sha })),
    ).toEqual({ git: { url: 'https://github.com/o/r.git', ref: sha } })
    expect(
      resolveEntrySource(
        '/m',
        entry({ source: 'git-subdir', url: 'https://h.example/r.git', path: 'x' }),
      ),
    ).toEqual({ git: { url: 'https://h.example/r.git', subdir: 'x' } })
    expect(resolveEntrySource('/m', entry({ source: 'npm', package: '@o/p@2.0.0' }))).toEqual({
      npm: { package: '@o/p', version: '2.0.0' },
    })
    const archive = entry(
      { source: 'archive', url: 'https://h.example/p.zip', sha256: 'B'.repeat(64) },
      { headers: { Authorization: 'x' } },
    )
    expect(resolveEntrySource('/m', archive)).toEqual({
      archive: {
        url: 'https://h.example/p.zip',
        sha256: 'b'.repeat(64),
        headers: { Authorization: 'x' },
      },
    })
  })

  it('takes owner/repo shorthand for git-subdir, and refuses an archive over http', () => {
    expect(
      resolveEntrySource('/m', entry({ source: 'git-subdir', url: 'o/r', path: 'p' })),
    ).toEqual({ git: { url: 'https://github.com/o/r.git', subdir: 'p' } })
    expect(() =>
      resolveEntrySource('/m', entry({ source: 'archive', url: 'http://x.example/p.zip' })),
    ).toThrow()
  })

  it('refuses a command source, and a relative one in a marketplace added by URL', () => {
    expect(() =>
      resolveEntrySource('/m', entry({ source: 'command', command: 'echo /x' })),
    ).toThrow('does not run')
    expect(() =>
      resolveEntrySource('/m', entry('./p'), { source: 'url', url: 'https://h.example/m.json' }),
    ).toThrow('cannot resolve')
  })
})
