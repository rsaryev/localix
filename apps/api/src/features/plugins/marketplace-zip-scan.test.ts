import { describe, expect, it } from 'bun:test'

import { makeZip } from '../../testing/zip-fixture'
import { scanZip, type ZipLimits } from './marketplace-zip-scan'

/**
 * The zip scan: the whole central directory read (its byte range, not the count the end record
 * claims), each local header agreeing with it, held to the extraction limits it is given. What a
 * scanned entry inflates to is held to its declared size when it is written
 * (`marketplace-archive-install.test.ts`).
 */

const small: ZipLimits = {
  maxEntries: 3,
  maxFileBytes: 1000,
  maxUncompressedBytes: 1500,
  maxCompressionRatio: 1000,
}

function summary(zip: Buffer, limits?: ZipLimits) {
  const { entries, totalBytes, largestBytes } = scanZip(zip, limits)
  return { entries, totalBytes, largestBytes }
}

describe('scanZip', () => {
  it('accepts an archive inside every limit, stored, deflated or ZIP64', () => {
    const zip = makeZip([
      { name: 'a', data: 'x'.repeat(10), deflate: false },
      { name: 'b/c', data: 'y'.repeat(20) },
      { name: 'd', data: 'z'.repeat(5), zip64: true },
    ])
    expect(summary(zip, small)).toEqual({ entries: 3, totalBytes: 35, largestBytes: 20 })
  })

  it('gives the unix mode an entry was zipped with, and none for an entry from elsewhere', () => {
    const zip = makeZip([
      { name: 'link', data: 'target', unixMode: 0o120777 },
      { name: 'plain', data: 'x' },
    ])
    const [link, plain] = scanZip(zip).members
    expect(link?.unixMode).toBe(0o120777)
    expect(plain?.unixMode).toBeUndefined()
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
    const honestSizes: ZipLimits = { ...small, maxUncompressedBytes: 10_000, maxEntries: 10 }
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
