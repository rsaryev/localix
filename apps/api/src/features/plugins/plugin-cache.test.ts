import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import {
  cachedVersionDir,
  markOrphaned,
  readInstallRecords,
  setInstallRecord,
  sweepOrphanedVersions,
} from './plugin-cache'

const home = tempDirPerTest('plugin-cache-')
const DAY = 24 * 60 * 60 * 1000

function versionDir(name: string, version: string): string {
  const dir = cachedVersionDir(home(), 'market', name, version)
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version }))
  return dir
}

describe('the plugin cache', () => {
  test('a version lives at cache/<marketplace>/<plugin>/<version>/ under the plugins root', () => {
    expect(cachedVersionDir('/h', 'mkt', 'p', '1.0.0')).toBe(
      join('/h', '.localix', 'plugins', 'cache', 'mkt', 'p', '1.0.0'),
    )
  })

  test('install records are kept in Claude Code’s installed_plugins.json shape', async () => {
    const dir = versionDir('p', '1.0.0')
    await setInstallRecord(home(), 'p@market', {
      installPath: dir,
      version: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
    })
    const file = join(home(), '.localix', 'plugins', 'installed_plugins.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 2,
      plugins: {
        'p@market': [
          {
            scope: 'user',
            installPath: dir,
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
            lastUpdated: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    })
    expect((await readInstallRecords(home()))['p@market']?.version).toBe('1.0.0')
    await setInstallRecord(home(), 'p@market', null)
    expect(await readInstallRecords(home())).toEqual({})
  })

  test('an orphaned version is removed 14 days after it was marked, not before', async () => {
    const live = versionDir('p', '2.0.0')
    const old = versionDir('p', '1.0.0')
    await setInstallRecord(home(), 'p@market', {
      installPath: live,
      version: '2.0.0',
      installedAt: 'x',
      lastUpdated: 'x',
    })
    const marked = Date.parse('2026-03-01T00:00:00.000Z')
    await markOrphaned(home(), old, () => marked)
    expect(existsSync(join(old, '.orphaned_at'))).toBe(true)

    expect(await sweepOrphanedVersions(home(), { now: () => marked + 13 * DAY })).toEqual([])
    expect(existsSync(old)).toBe(true)
    expect(await sweepOrphanedVersions(home(), { now: () => marked + 14 * DAY + 1 })).toEqual([old])
    expect(existsSync(old)).toBe(false)
    expect(existsSync(live)).toBe(true)
  })

  test('the sweep never removes a version a record still points at, and waits for a record', async () => {
    const dir = versionDir('p', '1.0.0')
    await markOrphaned(home(), dir, () => 0)
    // No install recorded at all: orphaned folders stay, as in Claude Code.
    expect(await sweepOrphanedVersions(home(), { now: () => 100 * DAY })).toEqual([])
    await setInstallRecord(home(), 'p@market', {
      installPath: dir,
      version: '1.0.0',
      installedAt: 'x',
      lastUpdated: 'x',
    })
    expect(await sweepOrphanedVersions(home(), { now: () => 100 * DAY })).toEqual([])
    expect(existsSync(dir)).toBe(true)
  })

  test('only a folder inside the cache is ever marked', async () => {
    const outside = join(home(), 'elsewhere')
    mkdirSync(outside, { recursive: true })
    await markOrphaned(home(), outside, () => 0)
    expect(existsSync(join(outside, '.orphaned_at'))).toBe(false)
  })
})
