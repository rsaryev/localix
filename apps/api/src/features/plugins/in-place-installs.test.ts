import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  discoverInPlacePlugins,
  inPlaceRecordsFile,
  readInPlaceRecords,
  setInPlaceRecord,
} from './in-place-installs'

const tempDir = tempDirPerTest('in-place-installs-')

/** A home with a marketplace registered in place at `<tmp>/market`, holding `tool`. */
function fixture() {
  const home = join(tempDir(), 'home')
  const market = join(tempDir(), 'market')
  writeTree(market, {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      owner: { name: 'Me' },
      plugins: [{ name: 'tool', source: './tool', description: 'From the entry' }],
    }),
    'tool/.claude-plugin/plugin.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
    'tool/skills/hello/SKILL.md': '---\nname: hello\ndescription: Says hello\n---\nHELLO-V1\n',
  })
  writeTree(home, {
    '.localix/marketplaces/known.json': JSON.stringify({
      mk: { source: { source: 'local', path: market }, installLocation: market },
    }),
  })
  return { home, market, installRoot: join(home, '.localix', 'plugins') }
}

describe('in-place install records', () => {
  test('a record is set, refused again without replace, and dropped', async () => {
    const { installRoot, market } = fixture()
    const record = { id: 'tool@mk', dir: join(market, 'tool') }
    expect(await setInPlaceRecord(installRoot, 'tool', record, { replace: false })).toBeNull()
    expect(await readInPlaceRecords(installRoot)).toEqual({ tool: record })
    await expect(
      setInPlaceRecord(installRoot, 'tool', record, { replace: false }),
    ).rejects.toMatchObject({ code: 'extension_exists' })
    // A copy installed over the name without replace is refused the same way.
    await expect(
      setInPlaceRecord(installRoot, 'tool', null, { replace: false }),
    ).rejects.toMatchObject({ code: 'extension_exists' })
    expect(await setInPlaceRecord(installRoot, 'tool', null)).toEqual(record)
    expect(await readInPlaceRecords(installRoot)).toEqual({})
    // Dropping what is not there writes nothing.
    expect(await setInPlaceRecord(installRoot, 'tool', null)).toBeNull()
  })

  test('a malformed records file reads as no records', async () => {
    const { installRoot } = fixture()
    await fs.mkdir(installRoot, { recursive: true })
    await fs.writeFile(inPlaceRecordsFile(installRoot), '{"tool": {"id": 3}, "x": [}')
    expect(await readInPlaceRecords(installRoot)).toEqual({})
  })
})

describe('discoverInPlacePlugins', () => {
  test('reads the folder where it is, with its entry, fresh on every call', async () => {
    const { home, market, installRoot } = fixture()
    await setInPlaceRecord(installRoot, 'tool', { id: 'tool@mk', dir: join(market, 'tool') })

    const [first] = await discoverInPlacePlugins({ homeDir: home, projectId: '' })
    expect(first?.dir).toBe(join(market, 'tool'))
    expect(first?.inPlaceInstall).toBe('tool@mk')
    expect(first?.scope).toBe('global')
    expect(first?.manifest.description).toBe('From the entry')
    expect(first?.provides.skills).toEqual(['hello'])

    // An edit in the folder shows at the next discovery, with no version bump.
    writeTree(join(market, 'tool'), {
      'skills/second/SKILL.md': '---\nname: second\ndescription: Two\n---\nSECOND\n',
    })
    const [second] = await discoverInPlacePlugins({ homeDir: home, projectId: 'p1' })
    expect(second?.provides.skills?.sort()).toEqual(['hello', 'second'])
    expect(second?.projectId).toBe('p1')
    expect(second?.manifest.version).toBe('1.0.0')
  })

  test('a record whose folder is gone shows nothing', async () => {
    const { home, installRoot } = fixture()
    await setInPlaceRecord(installRoot, 'gone', { id: 'gone@mk', dir: join(tempDir(), 'nope') })
    expect(await discoverInPlacePlugins({ homeDir: home, projectId: '' })).toEqual([])
  })
})
