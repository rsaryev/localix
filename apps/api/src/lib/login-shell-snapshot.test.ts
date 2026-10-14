import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CACHE_VERSION,
  MAX_SNAPSHOTS,
  readSnapshot,
  setSnapshotFile,
  writeSnapshot,
} from './login-shell-snapshot'

/**
 * The GUI launch's entry was evicted by terminal launches: slots went in WRITE order, so the
 * entry every packaged launch hit — written once, on the first launch — was always the oldest,
 * and the next packaged launch paid a full `zsh -ilc` probe. These pin least-recently-USED.
 */
describe('login-shell snapshot eviction', () => {
  let dir = ''
  let file = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'login-shell-snapshot-'))
    file = join(dir, 'snapshot.json')
    setSnapshotFile(file)
  })
  afterEach(() => {
    setSnapshotFile(undefined)
    rmSync(dir, { recursive: true, force: true })
  })

  const keys = () =>
    (JSON.parse(readFileSync(file, 'utf8')) as { entries: { key: string }[] }).entries.map(
      (e) => e.key,
    )

  test('a hit keeps the GUI entry alive past a full cache of terminal variants', () => {
    writeSnapshot({ key: 'gui', vars: { PATH: '/gui' } })
    for (let i = 0; i < MAX_SNAPSHOTS - 1; i += 1) writeSnapshot({ key: `term-${i}`, vars: {} })
    // A packaged launch hits the GUI entry; then one more terminal variant arrives.
    expect(readSnapshot('gui')).toEqual({ PATH: '/gui' })
    writeSnapshot({ key: 'term-new', vars: {} })
    expect(keys()).toContain('gui')
    expect(keys()).not.toContain('term-0')
    expect(readSnapshot('gui')).toEqual({ PATH: '/gui' })
  })

  // The positive control: without a hit in between, the oldest entry IS the one that goes, so
  // the test above proves the touch rather than a cache too large to ever evict.
  test('without a hit the least recently used entry is the one evicted', () => {
    writeSnapshot({ key: 'gui', vars: { PATH: '/gui' } })
    for (let i = 0; i < MAX_SNAPSHOTS; i += 1) writeSnapshot({ key: `term-${i}`, vars: {} })
    expect(keys()).toHaveLength(MAX_SNAPSHOTS)
    expect(keys()).not.toContain('gui')
    expect(readSnapshot('gui')).toBeUndefined()
  })

  test('holds room for a GUI entry beside several terminals', () => {
    expect(MAX_SNAPSHOTS).toBeGreaterThanOrEqual(8)
  })

  // Every boot reads the snapshot; the steady state (the same launch mode again) must not also
  // write it. A pretty-printed file survives a hit only if nothing rewrote it.
  test('a hit on the most recent entry does not rewrite the file', () => {
    const body = JSON.stringify(
      {
        version: CACHE_VERSION,
        entries: [
          { key: 'a', vars: {} },
          { key: 'b', vars: { X: '1' } },
        ],
      },
      null,
      2,
    )
    writeFileSync(file, body)
    expect(readSnapshot('b')).toEqual({ X: '1' })
    expect(readFileSync(file, 'utf8')).toBe(body)
    expect(readSnapshot('a')).toBeNull()
    expect(keys()).toEqual(['b', 'a'])
  })

  test('a miss changes nothing', () => {
    writeSnapshot({ key: 'a', vars: {} })
    const before = readFileSync(file, 'utf8')
    expect(readSnapshot('nope')).toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
