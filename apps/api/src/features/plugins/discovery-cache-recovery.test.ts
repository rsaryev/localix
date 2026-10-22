import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverPlugins } from './discovery'
import { SCAN_CACHE_VERSION } from './discovery-scan-cache'

test('a malformed scan cache falls back to discovery and is replaced with a readable cache', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'plugin-cache-recovery-'))
  const pluginDir = join(homeDir, '.localix', 'plugins', 'fixture')
  const cacheDir = join(homeDir, '.localix', 'cache')
  const cacheFile = join(cacheDir, 'plugin-scan-cache-v1.json')
  try {
    await mkdir(pluginDir, { recursive: true })
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ name: 'fixture', version: '1' }),
    )
    await writeFile(cacheFile, '{malformed')
    const found = await discoverPlugins({ homeDir, includeBundled: false })
    expect(found.map((plugin) => plugin.manifest.name)).toEqual(['fixture'])
    const repaired = JSON.parse(await readFile(cacheFile, 'utf8'))
    expect(repaired.version).toBe(SCAN_CACHE_VERSION)
    expect(repaired.fingerprint.length).toBeGreaterThan(0)
    expect(
      repaired.plugins.map((plugin: { manifest: { name: string } }) => plugin.manifest.name),
    ).toEqual(['fixture'])
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
