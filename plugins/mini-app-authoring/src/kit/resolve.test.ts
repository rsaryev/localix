import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '../testing/temp'
import { checksumOf, KIT_ARCHIVE, kitCacheRoot, resolveKit } from './resolve'

const tempDir = tempDirPerTest('mini-app-kit-resolve-')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function release(files: Record<string, string>, sumsFor?: Uint8Array) {
  const archive = await new Bun.Archive(files, { compress: 'gzip' }).bytes()
  const sums = `${sha(sumsFor ?? archive)}  ${KIT_ARCHIVE}\n${'0'.repeat(64)}  Localix-macos-arm64.dmg\n`
  const asked: string[] = []
  const fetchImpl = (async (url: string | URL) => {
    asked.push(String(url))
    if (String(url).endsWith('/SHA256SUMS.txt')) return new Response(sums)
    if (String(url).endsWith(`/${KIT_ARCHIVE}`)) return new Response(archive)
    return new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
  return { fetchImpl, asked }
}

const offlineDeps = (home: string, fetchImpl: typeof fetch) => ({
  env: { MINI_APP_KIT_RELEASES: 'https://releases.test' },
  home,
  fetch: fetchImpl,
  runtime: null,
  app: null,
})

describe('resolveKit', () => {
  test('a kit someone named wins over everything else', async () => {
    const source = await resolveKit({ env: { MINI_APP_KIT: '/somewhere/kit' } })
    expect(source).toEqual({ dir: '/somewhere/kit', from: 'named' })
  })

  test('the running Localix answers with its own kit', async () => {
    const fetchImpl = (async () =>
      Response.json({ dir: '/Localix/kit' })) as unknown as typeof fetch
    const source = await resolveKit({
      env: {},
      fetch: fetchImpl,
      runtime: { baseUrl: 'http://127.0.0.1:5051' },
    })
    expect(source).toEqual({ dir: '/Localix/kit', from: 'localix' })
  })

  test('the installed app’s kit is used when Localix is not running', async () => {
    const app = join(tempDir(), 'Localix.app')
    writeTree(join(app, 'Contents/Resources/resources/mini-app-kit'), {
      'kit.json': '{"authoring":{"tools":"tools/authoring.js"}}',
    })
    const source = await resolveKit({ env: {}, runtime: null, app })
    expect(source.from).toBe('app')
  })

  test('an older Localix, running or installed, gives way to the latest release kit', async () => {
    const home = tempDir()
    const app = join(home, 'Localix.app')
    writeTree(join(app, 'Contents/Resources/resources/mini-app-kit'), { 'kit.json': '{}' })
    const { fetchImpl } = await release({ 'kit.json': '{"kitModules":[]}' })
    const notFound = (async (url: string | URL) =>
      String(url).includes('/rpc/mini-apps/kit')
        ? new Response('not found', { status: 404 })
        : fetchImpl(url)) as unknown as typeof fetch
    const running = await resolveKit({
      ...offlineDeps(home, notFound),
      runtime: { baseUrl: 'http://127.0.0.1:5051' },
      app,
    })
    expect(running.from).toBe('release')
    const installed = await resolveKit({ ...offlineDeps(home, fetchImpl), app })
    expect(installed.from).toBe('release')
  })

  test('without Localix, the release kit is downloaded once, verified and kept', async () => {
    const home = tempDir()
    const { fetchImpl, asked } = await release({ 'kit.json': '{"kitModules":[]}' })
    const first = await resolveKit(offlineDeps(home, fetchImpl))
    expect(first.from).toBe('release')
    expect(readFileSync(join(first.dir, 'kit.json'), 'utf8')).toContain('kitModules')
    const second = await resolveKit(offlineDeps(home, fetchImpl))
    expect(second.dir).toBe(first.dir)
    expect(asked.filter((url) => url.endsWith(KIT_ARCHIVE))).toHaveLength(1)
  })

  test('an archive that does not match its checksum is refused and nothing is kept', async () => {
    const home = tempDir()
    const { fetchImpl } = await release({ 'kit.json': '{}' }, new Uint8Array([1, 2, 3]))
    await expect(resolveKit(offlineDeps(home, fetchImpl))).rejects.toThrow('checksum')
    expect(existsSync(kitCacheRoot({}, home))).toBe(false)
  })

  test('offline, the newest downloaded kit is used and nothing is fetched', async () => {
    const home = tempDir()
    writeTree(kitCacheRoot({}, home), { 'aaaa/kit.json': '{}' })
    const fetchImpl = (() => {
      throw new Error('fetched')
    }) as unknown as typeof fetch
    const source = await resolveKit({ ...offlineDeps(home, fetchImpl), offline: true })
    expect(source.dir).toBe(join(kitCacheRoot({}, home), 'aaaa'))
  })

  test('offline with nothing downloaded says so', async () => {
    const home = tempDir()
    await expect(resolveKit({ ...offlineDeps(home, fetch), offline: true })).rejects.toThrow(
      'No mini app kit',
    )
  })
})

test('checksumOf reads the line of one file', () => {
  const sums = `${'a'.repeat(64)}  one.tar.gz\n${'b'.repeat(64)} *two.tar.gz\n`
  expect(checksumOf(sums, 'two.tar.gz')).toBe('b'.repeat(64))
  expect(checksumOf(sums, 'three.tar.gz')).toBeNull()
})

test('downloaded kits live in the plugin data folder when Claude Code gives one', () => {
  expect(kitCacheRoot({ CLAUDE_PLUGIN_DATA: '/data/plugin' }, '/home/me')).toBe('/data/plugin/kits')
})
