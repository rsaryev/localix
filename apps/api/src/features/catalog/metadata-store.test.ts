import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { createCatalogMetadataStore } from './metadata-store'

/**
 * The runtime treats ANY throw from this store as "no cache" and refetches, so the
 * contract here is narrow: round-trip what it was given, and refuse to hand back
 * something that is not a snapshot. Silently returning a malformed object would put
 * `undefined` release dates into the catalog instead of triggering a refetch.
 */
describe('catalog metadata store', () => {
  const scratch = () => join(mkdtempSync(join(tmpdir(), 'localix-catalog-')), 'metadata.json')

  it('round-trips a snapshot through a file it creates', async () => {
    const file = scratch()
    try {
      const store = createCatalogMetadataStore(file)
      await store.write({
        fetchedAt: 1_700_000_000_000,
        releaseDates: { 'openrouter/x': '2026-01-02' },
      })
      expect(store.read()).toEqual({
        fetchedAt: 1_700_000_000_000,
        releaseDates: { 'openrouter/x': '2026-01-02' },
      })
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('replaces the file instead of rewriting it in place', async () => {
    // An in-place write that is interrupted leaves truncated JSON, and the next launch quietly
    // starts from the generated metadata. A replaced file is a new inode; a rewritten one is not.
    const file = scratch()
    try {
      writeFileSync(file, '{"fetchedAt":1,"releaseDates":{}}', 'utf8')
      const before = statSync(file).ino
      await createCatalogMetadataStore(file).write({ fetchedAt: 2, releaseDates: {} })
      expect(statSync(file).ino).not.toBe(before)
      expect(readdirSync(dirname(file))).toEqual([basename(file)])
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('throws for a missing file so the caller refetches', () => {
    expect(() => createCatalogMetadataStore(scratch()).read()).toThrow()
  })

  it('rejects a file that parses but is not a snapshot', () => {
    const file = scratch()
    try {
      const notSnapshots = [
        'null',
        '{}',
        '{"fetchedAt":"soon","releaseDates":{}}',
        '{"fetchedAt":1}',
      ]
      for (const body of notSnapshots) {
        writeFileSync(file, body, 'utf8')
        expect(createCatalogMetadataStore(file).read()).toBeUndefined()
      }
    } finally {
      rmSync(file, { force: true })
    }
  })
})
