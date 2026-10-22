import { afterEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { stubFetch } from '../../testing/fetch-stub'
import { makeZip } from '../../testing/zip-fixture'
import { fetchArchivePlugin } from './marketplace-source-archive'
import { verifyZipMembers } from './marketplace-zip-inflate'
import { ZIP_LIMITS, scanZip, type ZipLimits } from './marketplace-zip-scan'

/**
 * The zip pre-scan: an archive is held to Claude Code's extraction limits (entries, one file's
 * size, total size, compression ratio) before `unzip` touches it. The scan reads the whole central
 * directory the way `unzip` does, and every deflated entry is inflated into a counter so a size
 * the zip lies about cannot slip past the limits.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const dir = tempDirPerTest('mkt-zip')

const small: ZipLimits = {
  maxEntries: 3,
  maxFileBytes: 1000,
  maxTotalBytes: 1500,
  maxRatio: 1000,
}

function summary(zip: Buffer, limits?: ZipLimits) {
  const { entries, totalBytes, largestBytes } = scanZip(zip, limits)
  return { entries, totalBytes, largestBytes }
}

describe('scanZip', () => {
  it('uses Claude Code extraction limits by default', () => {
    expect(ZIP_LIMITS).toEqual({
      maxEntries: 100_000,
      maxFileBytes: 512 * 1024 * 1024,
      maxTotalBytes: 1024 * 1024 * 1024,
      maxRatio: 50,
    })
  })

  it('accepts an archive inside every limit, stored, deflated or ZIP64', () => {
    const zip = makeZip([
      { name: 'a', data: 'x'.repeat(10), deflate: false },
      { name: 'b/c', data: 'y'.repeat(20) },
      { name: 'd', data: 'z'.repeat(5), zip64: true },
    ])
    expect(summary(zip, small)).toEqual({ entries: 3, totalBytes: 35, largestBytes: 20 })
  })

  it('refuses too many entries, a too-large file, or a too-large total', () => {
    const many = makeZip([1, 2, 3, 4].map((n) => ({ name: `f${n}`, data: 'x' })))
    expect(() => scanZip(many, small)).toThrow('4 entries (limit 3)')
    const big = makeZip([{ name: 'a', data: 'x'.repeat(1001) }])
    expect(() => scanZip(big, small)).toThrow('a file of 1001 bytes (limit 1000)')
    const total = makeZip([
      { name: 'a', data: 'x'.repeat(900) },
      { name: 'b', data: 'y'.repeat(900) },
    ])
    expect(() => scanZip(total, small)).toThrow('more than 1500 bytes')
  })

  it('refuses a compression ratio above 50, including sizes declared through ZIP64', () => {
    const bomb = makeZip([{ name: 'bomb', data: Buffer.alloc(5 * 1024 * 1024), zip64: true }])
    expect(() => scanZip(bomb)).toThrow('more than 50 times')
  })

  it('reads the whole directory, not the entry count the end record claims', () => {
    // `unzip` keeps reading central headers past the count, so the hidden entries would land.
    const lying = makeZip(
      [
        { name: 'small', data: 'x'.repeat(200) },
        ...[1, 2, 3].map((n) => ({ name: `huge${n}`, data: 'y'.repeat(900) })),
      ],
      { count: 1 },
    )
    expect(() => scanZip(lying, small)).toThrow('more than 1500 bytes')
    const honestSizes: ZipLimits = { ...small, maxTotalBytes: 10_000, maxEntries: 10 }
    expect(() => scanZip(lying, honestSizes)).toThrow('counts 1 entries; its directory holds 4')
  })

  it('refuses a local header whose sizes disagree with the directory', () => {
    const zip = makeZip([{ name: 'a', data: 'x'.repeat(10), deflate: false }])
    zip.writeUInt32LE(5000, 22) // the local header's uncompressed size
    expect(() => scanZip(zip, small)).toThrow('local header that disagrees')
  })

  it('refuses a file that is not a zip', () => {
    expect(() => scanZip(Buffer.from('not a zip at all, just text'))).toThrow('not a zip file')
  })
})

describe('verifyZipMembers', () => {
  it('passes entries that inflate to what they declare', async () => {
    const zip = makeZip([{ name: 'a', data: 'hello '.repeat(100) }])
    await verifyZipMembers(zip, scanZip(zip).members)
  })

  it('refuses an entry that inflates past its declared size', async () => {
    const zip = makeZip([{ name: 'bomb', data: Buffer.alloc(1024 * 1024), declaredBytes: 10 }])
    expect(summary(zip)).toEqual({ entries: 1, totalBytes: 10, largestBytes: 10 })
    await expect(verifyZipMembers(zip, scanZip(zip).members)).rejects.toThrow(
      'declares 10 bytes but inflates to more',
    )
  })

  it('refuses an entry that inflates short of its declared size', async () => {
    const zip = makeZip([{ name: 'a', data: 'x'.repeat(10), declaredBytes: 20 }])
    await expect(verifyZipMembers(zip, scanZip(zip).members)).rejects.toThrow('inflates to 10')
  })
})

describe('fetchArchivePlugin limits', () => {
  it('stops an archive download before unzip runs', async () => {
    const bomb = makeZip([{ name: 'p/huge.bin', data: Buffer.alloc(100 * 1024 * 1024) }])
    globalThis.fetch = stubFetch(async () => new Response(new Uint8Array(bomb)))
    const dest = join(dir(), 'out')
    await expect(fetchArchivePlugin({ url: 'https://a.example/p.zip' }, dest)).rejects.toThrow(
      'more than 50 times',
    )
    expect(await fs.stat(dest).catch(() => null)).toBeNull()
  })

  it('refuses an entry whose declared size understates what it inflates to', async () => {
    const bomb = makeZip([
      { name: 'p/.claude-plugin/plugin.json', data: '{"name":"p"}' },
      { name: 'p/huge.bin', data: Buffer.alloc(8 * 1024 * 1024), declaredBytes: 10 },
    ])
    globalThis.fetch = stubFetch(async () => new Response(new Uint8Array(bomb)))
    const dest = join(dir(), 'out')
    await expect(fetchArchivePlugin({ url: 'https://a.example/p.zip' }, dest)).rejects.toThrow(
      'p/huge.bin declares 10 bytes but inflates to more',
    )
    expect(await fs.stat(dest).catch(() => null)).toBeNull()
  })
})
