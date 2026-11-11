import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { discoverCachedPlugins } from './cached-installs'
import { setInstallRecord } from './plugin-cache'

/**
 * A user-scope copy from a marketplace is the plugin as it was fetched, read with its entry at
 * every load (`kit` `mergeEntryWithManifest`). A copy an earlier Localix wrote its entry into
 * (`plugin.json` combined with it, or made from it) loads as it did.
 */
const tempDir = tempDirPerTest('cached-installs-')

const SKILL = (name: string) => `---\nname: ${name}\ndescription: Skill ${name}\n---\nbody\n`

async function home(entry: Record<string, unknown>, copy: Record<string, string>) {
  const homeDir = join(tempDir(), 'home')
  const market = join(tempDir(), 'market')
  writeTree(market, {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      owner: { name: 'Me' },
      plugins: [{ name: 'tool', source: './tool', ...entry }],
    }),
    'tool/README.md': 'x',
  })
  writeTree(homeDir, {
    '.localix/marketplaces/known_marketplaces.json': JSON.stringify({
      mk: {
        source: { source: 'directory', path: market },
        installLocation: market,
        lastUpdated: '2026-10-20T10:00:00.000Z',
      },
    }),
  })
  const installPath = join(homeDir, '.localix/plugins/cache/mk/tool/1.0.0')
  writeTree(installPath, copy)
  await setInstallRecord(homeDir, 'tool@mk', {
    installPath,
    version: '1.0.0',
    installedAt: '',
    lastUpdated: '',
  })
  const [plugin] = await discoverCachedPlugins({ homeDir, projectId: '' })
  return { plugin: plugin!, installPath }
}

const skills = (plugin: { provides: { skills: readonly string[] } }) =>
  [...plugin.provides.skills].sort()

describe('a cached marketplace copy', () => {
  test('a copy as fetched loads with its entry: its components, description and version', async () => {
    const { plugin } = await home(
      { description: 'From the entry', version: '1.0.0', skills: ['./extra/one'] },
      { 'extra/one/SKILL.md': SKILL('one') },
    )
    expect(plugin.error).toBeUndefined()
    expect(plugin.manifest.description).toBe('From the entry')
    expect(plugin.manifest.version).toBe('1.0.0')
    expect(skills(plugin)).toEqual(['one'])
    expect(plugin.cachedInstall).toEqual({ id: 'tool@mk', version: '1.0.0' })
  })

  test('a plugin.json an earlier Localix combined with a strict entry loads as it did', async () => {
    const { plugin } = await home(
      { description: 'Entry text', skills: ['./extra/one'] },
      {
        // Written by the old installer: the manifest's own fields, the entry's appended.
        '.claude-plugin/plugin.json': JSON.stringify({
          name: 'tool',
          version: '2.0.0',
          description: 'Entry text',
          skills: ['./extra/one'],
        }),
        'extra/one/SKILL.md': SKILL('one'),
        'skills/own/SKILL.md': SKILL('own'),
      },
    )
    expect(plugin.error).toBeUndefined()
    expect(plugin.manifest.version).toBe('2.0.0')
    expect(plugin.manifest.description).toBe('Entry text')
    expect(skills(plugin)).toEqual(['one', 'own'])
  })

  test('a plugin.json an earlier Localix made from a strict:false entry is dropped, and the copy loads as it did', async () => {
    const entry = { strict: false, description: 'Entry only', skills: ['./extra/one'] }
    const { plugin, installPath } = await home(entry, {
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'tool',
        description: 'Entry only',
        skills: ['./extra/one'],
      }),
      'extra/one/SKILL.md': SKILL('one'),
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.manifest.description).toBe('Entry only')
    expect(skills(plugin)).toEqual(['one'])
    expect(await fs.exists(join(installPath, '.claude-plugin/plugin.json'))).toBe(false)
  })
})
