/**
 * The plugin scan cache must never hide a change made while a scan was reading the folders (a
 * plugin installed just after the API booted), and must never recreate a deleted project's
 * folder to store a cache in it.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { scanDirsCached } from './discovery-cached-scan'
import { scanDirs } from './discovery-directory-scan'

const dir = tempDirPerTest('plugin-scan-')
const SUBDIRS = ['.localix/plugins']

function addPlugin(baseDir: string, name: string) {
  const pluginDir = join(baseDir, '.localix', 'plugins', name)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name, version: '1' }))
}
const names = (plugins: { manifest: { name: string } }[]) => plugins.map((p) => p.manifest.name)

describe('scanDirsCached', () => {
  test('a plugin added while a scan runs is found by the next call', async () => {
    const base = dir()
    addPlugin(base, 'first')
    const first = await scanDirsCached(base, SUBDIRS, 'project', 'p', {
      scan: async (...args) => {
        const found = await scanDirs(...args)
        addPlugin(base, 'second')
        return found
      },
    })
    expect(names(first)).toEqual(['first'])
    expect(names(await scanDirsCached(base, SUBDIRS, 'project', 'p')).sort()).toEqual([
      'first',
      'second',
    ])
  })

  test('a caller joining a running scan is not handed what it read before a change', async () => {
    const base = dir()
    addPlugin(base, 'first')
    let started!: () => void
    const scanning = new Promise<void>((resolve) => (started = resolve))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const running = scanDirsCached(base, SUBDIRS, 'project', 'p', {
      scan: async (...args) => {
        const found = await scanDirs(...args)
        started()
        await gate
        return found
      },
    })
    await scanning
    const joined = scanDirsCached(base, SUBDIRS, 'project', 'p')
    addPlugin(base, 'installed')
    release()
    expect(names(await running)).toEqual(['first'])
    expect(names(await joined).sort()).toEqual(['first', 'installed'])
  })

  test('a scan of a folder that is gone does not recreate it', async () => {
    const gone = join(dir(), 'deleted-project')
    expect(await scanDirsCached(gone, SUBDIRS, 'project', 'p')).toEqual([])
    expect(existsSync(gone)).toBe(false)
  })
})
