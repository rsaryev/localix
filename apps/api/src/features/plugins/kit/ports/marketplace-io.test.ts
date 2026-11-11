import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { makeZip } from '../../../../testing/zip-fixture'
import {
  diskPluginDirectories,
  diskPluginStateStore,
  gitTags,
  nodeSha256,
  zipArchiveReader,
} from './marketplace-io'

const dir = tempDirPerTest('kit-marketplace-io')
const signal = new AbortController().signal

describe('the marketplace effects', () => {
  test('hashes bytes as lower-case hex', async () => {
    const bytes = new TextEncoder().encode('abc')
    expect(await nodeSha256.hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  test('lists the entries of a zip, its links with where they point, nothing extracted', async () => {
    const zip = makeZip([
      { name: 'plugin/', data: '', deflate: false },
      { name: 'plugin/a.md', data: 'hello' },
      { name: 'plugin/link', data: '../outside', unixMode: 0o120777 },
      { name: 'plugin/stored-link', data: 'a.md', unixMode: 0o120777, deflate: false },
      { name: 'plugin/run.sh', data: 'x', unixMode: 0o100755 },
    ])
    expect(await zipArchiveReader.scan(new Uint8Array(zip), signal)).toEqual({
      entries: [
        { path: 'plugin/', size: 0, isSymlink: false },
        { path: 'plugin/a.md', size: 5, isSymlink: false },
        { path: 'plugin/link', size: 10, isSymlink: true, linkTarget: '../outside' },
        { path: 'plugin/stored-link', size: 4, isSymlink: true, linkTarget: 'a.md' },
        { path: 'plugin/run.sh', size: 1, isSymlink: false },
      ],
    })
  })

  test('leaves the extraction limits to the kit, and calls unreadable bytes corrupt', async () => {
    const many = makeZip(
      Array.from({ length: 3 }, (_, n) => ({ name: `f${n}`, data: 'x'.repeat(2_000) })),
    )
    expect(await zipArchiveReader.scan(new Uint8Array(many), signal)).toMatchObject({
      entries: [{ path: 'f0' }, { path: 'f1' }, { path: 'f2' }],
    })
    expect(await zipArchiveReader.scan(new Uint8Array([1, 2, 3]), signal)).toMatchObject({
      failure: 'corrupt',
    })
    expect(await zipArchiveReader.scan(new Uint8Array(many), AbortSignal.abort())).toMatchObject({
      failure: 'aborted',
    })
  })

  test('a link whose target is longer than a path can be fails the scan, never inflated whole', async () => {
    const long = 'a/'.repeat(4096)
    for (const deflate of [true, false]) {
      const zip = makeZip([{ name: 'link', data: long, unixMode: 0o120777, deflate }])
      expect(await zipArchiveReader.scan(new Uint8Array(zip), signal)).toEqual({
        failure: 'corrupt',
        message: 'The archive entry link is a symbolic link whose target is over 4096 bytes',
      })
    }
    // A link whose header understates its target is held to the bound, not to the header.
    const lying = makeZip([{ name: 'link', data: long, unixMode: 0o120777, declaredBytes: 10 }])
    expect(await zipArchiveReader.scan(new Uint8Array(lying), signal)).toMatchObject({
      failure: 'corrupt',
    })
    const fits = 'b'.repeat(4096)
    const ok = makeZip([{ name: 'link', data: fits, unixMode: 0o120777 }])
    expect(await zipArchiveReader.scan(new Uint8Array(ok), signal)).toMatchObject({
      entries: [{ path: 'link', linkTarget: fits }],
    })
  })

  test('lists the tags of a repository, and an unreachable one is a failure', async () => {
    const urls: string[] = []
    const tags = gitTags(async (url) => {
      urls.push(url)
      if (url.includes('down')) throw new Error('could not resolve host')
      return ['demo--v1.0.0']
    })
    expect(await tags.list({ shorthand: 'acme/tools' }, signal)).toEqual(['demo--v1.0.0'])
    expect(await tags.list({ url: 'https://git.example/down.git' }, signal)).toMatchObject({
      failure: 'connection',
    })
    expect(urls).toEqual(['https://github.com/acme/tools.git', 'https://git.example/down.git'])
    expect(await tags.list({ shorthand: 'a/b' }, AbortSignal.abort())).toMatchObject({
      failure: 'aborted',
    })
  })

  test('keeps the state files under the plugins root, written whole', async () => {
    const store = diskPluginStateStore(() => join(dir(), 'plugins'))
    expect(await store.read('installed_plugins.json', signal)).toBeUndefined()
    expect(await store.modifiedAt('installed_plugins.json', signal)).toBeUndefined()
    expect(await store.write('installed_plugins.json', '{"version":2}', signal)).toBeUndefined()
    expect(await store.read('installed_plugins.json', signal)).toBe('{"version":2}')
    expect(readFileSync(join(dir(), 'plugins/installed_plugins.json'), 'utf8')).toBe(
      '{"version":2}',
    )
    expect(await store.names(signal)).toEqual(['installed_plugins.json'])
    expect(typeof (await store.modifiedAt('installed_plugins.json', signal))).toBe('number')
    expect(await store.remove('installed_plugins.json', signal)).toBeUndefined()
    expect(await store.remove('installed_plugins.json', signal)).toBeUndefined()
    expect(existsSync(join(dir(), 'plugins/installed_plugins.json'))).toBe(false)
  })

  test('a state file that cannot be written is a failure', async () => {
    writeTree(dir(), { plugins: 'a file where the folder should be' })
    const store = diskPluginStateStore(() => join(dir(), 'plugins'))
    expect(await store.write('x.json', '{}', signal)).toMatchObject({ failure: 'write' })
    expect(await store.names(signal)).toEqual([])
  })

  test('a state entry that cannot be removed is a failure', async () => {
    writeTree(dir(), { 'plugins/held.json/inner': '' })
    const store = diskPluginStateStore(() => join(dir(), 'plugins'))
    expect(await store.remove('held.json', signal)).toMatchObject({ failure: 'remove' })
  })

  test('opens a directory a command source printed, and nothing for a missing one', async () => {
    writeTree(dir(), { 'out/.claude-plugin/plugin.json': '{}' })
    const files = await diskPluginDirectories.open(join(dir(), 'out'), signal)
    expect(await files?.readText('.claude-plugin/plugin.json')).toBe('{}')
    expect(await diskPluginDirectories.open(join(dir(), 'none'), signal)).toBeUndefined()
  })
})
