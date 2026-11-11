import { afterEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'
import type { ArchiveFetchPlan } from '@rsaryev/llx-plugin/marketplace'

import { stubFetch } from '../../testing/fetch-stub'
import { makeZip, type ZipFixtureEntry } from '../../testing/zip-fixture'
import { ARCHIVE_LIMITS } from './kit'
import { fetchArchivePlugin } from './marketplace-source-archive'

/**
 * An `archive` plugin source end to end over real crafted zips: the kit's `fetchArchive` judges
 * the download, the pin, the limits, the root and every path and link; Localix writes exactly the
 * entries the kit judged. A zip-slip, an escaping or absolute link, and a write through a link are
 * refused whole and nothing lands in `dest` or beside it.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const dir = tempDirPerTest('mkt-archive-install')

const plan = (url = 'https://artifacts.example/p.zip', sha256?: string): ArchiveFetchPlan => ({
  kind: 'archive',
  url,
  ...(sha256 ? { sha256 } : {}),
  limits: ARCHIVE_LIMITS,
  headers: {},
  rootDepth: 'top-or-one-down',
})

const MANIFEST = { name: 'p/.claude-plugin/plugin.json', data: '{"name":"p"}' }
const LINK = 0o120777

function serving(entries: ZipFixtureEntry[]): Buffer {
  const zip = makeZip(entries)
  globalThis.fetch = stubFetch(async () => new Response(new Uint8Array(zip)))
  return zip
}

async function refused(entries: ZipFixtureEntry[], message: string): Promise<void> {
  serving(entries)
  const root = dir()
  const dest = join(root, 'out')
  await expect(fetchArchivePlugin(plan(), dest)).rejects.toThrow(message)
  expect(await fs.readdir(root)).toEqual([])
}

describe('fetchArchivePlugin', () => {
  it('writes the plugin one folder down, files, folders and an inside link', async () => {
    const zip = serving([
      MANIFEST,
      { name: 'p/skills/', data: '' },
      { name: 'p/skills/fmt/SKILL.md', data: '---\nname: fmt\n---\n' },
      { name: 'p/bin/run.sh', data: '#!/bin/sh\n', unixMode: 0o100755 },
      { name: 'p/skills/alias', data: 'fmt', unixMode: LINK },
    ])
    const dest = join(dir(), 'out')
    const sha = createHash('sha256').update(zip).digest('hex')
    await fetchArchivePlugin(plan(undefined, sha), dest)
    expect(await fs.readFile(join(dest, '.claude-plugin/plugin.json'), 'utf8')).toBe('{"name":"p"}')
    expect(await fs.readFile(join(dest, 'skills/alias/SKILL.md'), 'utf8')).toContain('fmt')
    expect(await fs.readlink(join(dest, 'skills/alias'))).toBe('fmt')
    expect((await fs.stat(join(dest, 'bin/run.sh'))).mode & 0o111).not.toBe(0)
  })

  it('refuses a zip-slip entry', async () => {
    await refused([MANIFEST, { name: 'p/../../evil', data: 'x' }], 'outside the plugin directory')
  })

  it('refuses a link that leaves the plugin, relative or absolute', async () => {
    await refused([MANIFEST, { name: 'p/up', data: '../..', unixMode: LINK }], 'leaves the plugin')
    await refused([MANIFEST, { name: 'p/abs', data: '/etc', unixMode: LINK }], 'leaves the plugin')
  })

  it('refuses an entry written through a link', async () => {
    await refused(
      [MANIFEST, { name: 'p/here', data: '.', unixMode: LINK }, { name: 'p/here/x', data: 'x' }],
      'link',
    )
  })

  it('writes a link mode from another system as the plain file the kit judged', async () => {
    serving([MANIFEST, { name: 'p/up', data: '../../../etc', unixMode: LINK, madeOn: 5 }])
    const dest = join(dir(), 'out')
    await fetchArchivePlugin(plan(), dest)
    const up = await fs.lstat(join(dest, 'up'))
    expect(up.isSymbolicLink()).toBe(false)
    expect(await fs.readFile(join(dest, 'up'), 'utf8')).toBe('../../../etc')
  })

  it('refuses an entry that inflates past the size it declares', async () => {
    await refused(
      [MANIFEST, { name: 'p/huge.bin', data: Buffer.alloc(1024 * 1024), declaredBytes: 10 }],
      'p/huge.bin declares 10 bytes',
    )
  })

  it('refuses a duplicate entry instead of overwriting the first', async () => {
    await refused(
      [MANIFEST, { name: 'p/a', data: 'one' }, { name: 'p/a', data: 'two' }],
      'Archive entry p/a cannot be written',
    )
  })

  it('refuses a loopback or metadata host, and a pin that does not match, before writing', async () => {
    serving([MANIFEST])
    for (const url of ['https://127.0.0.1/p.zip', 'https://169.254.169.254/p.zip'])
      await expect(fetchArchivePlugin(plan(url), join(dir(), 'x'))).rejects.toThrow(
        'loopback, link-local or cloud-metadata',
      )
    await expect(
      fetchArchivePlugin(plan(undefined, '0'.repeat(64)), join(dir(), 'y')),
    ).rejects.toThrow('integrity check failed')
  })

  it('refuses a redirect to a loopback host before requesting it', async () => {
    const asked: string[] = []
    globalThis.fetch = stubFetch(async (input) => {
      asked.push(String(input instanceof Request ? input.url : input))
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/p.zip' } })
    })
    await expect(fetchArchivePlugin(plan(), join(dir(), 'out'))).rejects.toThrow('redirect')
    expect(asked).toEqual(['https://artifacts.example/p.zip'])
  })

  it('refuses a zip past the compression ratio before writing anything', async () => {
    await refused(
      [MANIFEST, { name: 'p/huge.bin', data: Buffer.alloc(100 * 1024 * 1024) }],
      'more than 50 times',
    )
  })

  it('takes the folder beside the __MACOSX one that Finder adds as the plugin', async () => {
    serving([MANIFEST, { name: '__MACOSX/p/._x', data: 'fork' }])
    const dest = join(dir(), 'out')
    await fetchArchivePlugin(plan(), dest)
    expect(await fs.readdir(dest)).toEqual(['.claude-plugin'])
  })
})
