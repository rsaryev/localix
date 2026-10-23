import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { retireLegacyPluginCopies } from './legacy-plugin-copies'

const home = tempDirPerTest('legacy-plugin-copies-')

function folder(name: string, marker?: object) {
  const dir = join(home(), '.localix', 'plugins', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), name)
  if (marker) writeFileSync(join(dir, '.localix-managed.json'), JSON.stringify(marker))
  return dir
}

describe('the managed copies earlier versions kept among the plugins', () => {
  test('are removed on start; the person’s own plugins stay', async () => {
    const chess = folder('chess', { kind: 'localix-bundled-plugin', fingerprint: 'abc' })
    const own = folder('formatter')
    const foreign = folder('odd', { kind: 'something-else', fingerprint: 'x' })
    expect(await retireLegacyPluginCopies(home())).toEqual(['chess'])
    expect(existsSync(chess)).toBe(false)
    expect(existsSync(own)).toBe(true)
    expect(existsSync(foreign)).toBe(true)
  })

  test('a home with no plugins folder is nothing to do', async () => {
    expect(await retireLegacyPluginCopies(home())).toEqual([])
  })
})
