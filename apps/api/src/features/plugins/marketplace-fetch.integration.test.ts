import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { runSync, scratchGitEnv, tempDirPerTest, writeTree } from '@localixai/testing'

import { fetchGitTree } from './git-fetch'
import { fetchArchivePlugin } from './marketplace-source-archive'
import { stubFetch } from '../../testing/fetch-stub'

/**
 * The real fetchers behind Claude Code plugin sources: `git` over a local repository (a pinned
 * commit, a sparse `git-subdir` checkout) and `unzip` over a stored zip served by a stubbed fetch.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const dir = tempDirPerTest('cc-fetch')

function git(cwd: string, ...args: string[]): string {
  const result = runSync('git', args, { cwd, env: scratchGitEnv() })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

describe('fetchGitTree', () => {
  it('checks out a pinned commit after the branch moved on, and a sparse subdirectory', async () => {
    const repo = join(dir(), 'repo')
    writeTree(repo, { 'tools/mono/a.txt': 'v1', 'other/b.txt': 'b' })
    git(repo, 'init', '--quiet', '--initial-branch=main')
    git(repo, 'add', '.')
    git(repo, 'commit', '--quiet', '-m', 'one')
    const pinned = git(repo, 'rev-parse', 'HEAD')
    writeTree(repo, { 'tools/mono/a.txt': 'v2' })
    git(repo, 'commit', '--quiet', '-am', 'two')
    const url = `file://${repo}`

    const at = join(dir(), 'pinned')
    await fetchGitTree(url, at, { ref: pinned, sparse: 'tools/mono' })
    expect(await fs.readFile(join(at, 'tools/mono/a.txt'), 'utf8')).toBe('v1')
    expect(await fs.stat(join(at, 'other')).catch(() => null)).toBeNull()

    const head = join(dir(), 'head')
    await fetchGitTree(url, head, { ref: 'main' })
    expect(await fs.readFile(join(head, 'tools/mono/a.txt'), 'utf8')).toBe('v2')

    // An abbreviated commit cannot be fetched by name; the full fetch finds it.
    const short = join(dir(), 'short')
    await fetchGitTree(url, short, { ref: pinned.slice(0, 10) })
    expect(await fs.readFile(join(short, 'tools/mono/a.txt'), 'utf8')).toBe('v1')
  })
})

/** A zip with stored (uncompressed) entries — enough for `unzip`. */
function storedZip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const path = Buffer.from(name)
    const crc = Bun.hash.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(path.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(path.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, path, data)
    centrals.push(central, path)
    offset += local.length + path.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

describe('fetchArchivePlugin', () => {
  const zip = storedZip({
    'formatter/.claude-plugin/plugin.json': '{"name":"formatter"}',
    'formatter/skills/fmt/SKILL.md': '---\nname: fmt\ndescription: Format\n---\n',
  })
  const sha256 = createHash('sha256').update(zip).digest('hex')

  it('unpacks a plugin one folder down, checked against its sha256 pin', async () => {
    globalThis.fetch = stubFetch(async () => new Response(zip))
    const dest = join(dir(), 'out')
    await fetchArchivePlugin({ url: 'https://artifacts.example/f.zip', sha256 }, dest)
    expect(await fs.readFile(join(dest, '.claude-plugin/plugin.json'), 'utf8')).toContain(
      'formatter',
    )
    await expect(
      fetchArchivePlugin({ url: 'https://artifacts.example/f.zip', sha256: '0'.repeat(64) }, dest),
    ).rejects.toThrow('sha256 pin')
  })

  it('refuses a loopback or metadata host before fetching', async () => {
    globalThis.fetch = stubFetch(async () => {
      throw new Error('must not fetch')
    })
    for (const url of ['https://127.0.0.1/p.zip', 'https://169.254.169.254/p.zip'])
      await expect(fetchArchivePlugin({ url }, join(dir(), 'x'))).rejects.toThrow('public host')
  })
})
