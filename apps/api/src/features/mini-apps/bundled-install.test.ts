import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  __resetBundledSyncCache,
  bundledStagingFailures,
  syncBundledMiniApps,
} from './bundled-install'
import { pruneRetiredManagedCopies } from './managed-copy'

const roots: string[] = []

async function fixture(): Promise<{ source: string; home: string }> {
  const root = await fs.mkdtemp(join(tmpdir(), 'bundled-install-'))
  roots.push(root)
  return { source: join(root, 'mini-apps'), home: join(root, 'home') }
}

async function writePlugin(
  source: string,
  name: string,
  description: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const dir = join(source, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'mini-app.json'), JSON.stringify({ name, description, ...extra }))
}

async function managedFingerprint(home: string, name: string): Promise<string> {
  const marker = JSON.parse(
    await fs.readFile(join(home, '.localix/mini-apps', name, '.localix-managed.json'), 'utf8'),
  ) as { fingerprint: string }
  return marker.fingerprint
}

async function writeStagedMarker(
  source: string,
  pluginHashes: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await fs.writeFile(
    join(source, '.localix-staged.json'),
    JSON.stringify({
      kind: 'localix-staged-plugins',
      schemaVersion: 3,
      hashAlgorithm: 'sha256',
      pluginHashes,
      unavailable: {},
      ...overrides,
    }),
  )
}

async function expectFallbackUpdate(
  source: string,
  home: string,
  stagedFingerprint: string,
): Promise<void> {
  __resetBundledSyncCache()
  await syncBundledMiniApps(source, home)
  expect(
    JSON.parse(await fs.readFile(join(home, '.localix/mini-apps/weather/mini-app.json'), 'utf8')),
  ).toMatchObject({ description: 'v2' })
  expect(await managedFingerprint(home, 'weather')).not.toBe(stagedFingerprint)
}

afterEach(async () => {
  __resetBundledSyncCache()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('bundled plugin installation', () => {
  test('copies first-party sources into the global .localix root', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')

    const managed = await syncBundledMiniApps(source, home)

    expect(managed).toEqual(new Set(['weather']))
    expect(
      JSON.parse(await fs.readFile(join(home, '.localix/mini-apps/weather/mini-app.json'), 'utf8')),
    ).toMatchObject({ name: 'weather', description: 'v1' })
    expect(
      JSON.parse(
        await fs.readFile(join(home, '.localix/mini-apps/weather/.localix-managed.json'), 'utf8'),
      ),
    ).toMatchObject({ kind: 'localix-bundled-plugin' })
  })

  test('retires the managed copy of a plugin that no longer ships, never a user plugin', async () => {
    const { source, home } = await fixture()
    const installRoot = join(home, '.localix', 'mini-apps')
    await writePlugin(source, 'weather', 'v1')
    await writePlugin(source, 'retired', 'v1')
    await syncBundledMiniApps(source, home)
    await writePlugin(installRoot, 'mine', 'a user plugin, no marker')

    await fs.rm(join(source, 'retired'), { recursive: true })
    // A complete staging that no longer lists it: the only proof of removal the sync accepts.
    await writeStagedMarker(source, { weather: await managedFingerprint(home, 'weather') })
    __resetBundledSyncCache()
    await syncBundledMiniApps(source, home)

    const names = await fs.readdir(installRoot)
    expect(names).toContain('weather')
    expect(names).toContain('mine')
    expect(names).not.toContain('retired')
    // Renamed aside, not deleted: its backend may be the module this process runs.
    expect(names.some((name) => name.startsWith('.sync-retired-retired-'))).toBe(true)
  })

  test('a plugin mid-restage (no complete staging to prove removal) is not retired', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    await fs.rm(join(source, 'weather'), { recursive: true })

    __resetBundledSyncCache()
    await syncBundledMiniApps(source, home)
    expect(await fs.readdir(join(home, '.localix', 'mini-apps'))).toContain('weather')
  })

  test('never overwrites an unmarked same-name user installation', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'bundled')
    await writePlugin(join(home, '.localix', 'mini-apps'), 'weather', 'user')

    const managed = await syncBundledMiniApps(source, home)

    expect(managed.has('weather')).toBe(false)
    expect(
      JSON.parse(await fs.readFile(join(home, '.localix/mini-apps/weather/mini-app.json'), 'utf8')),
    ).toMatchObject({ description: 'user' })
  })

  test('restores the previous managed copy when activating an update fails', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    await writePlugin(source, 'weather', 'updated version')
    // These tests drive a SECOND pass; step past the freshness window so it runs.
    __resetBundledSyncCache()

    const installDir = join(home, '.localix/mini-apps/weather')
    const realRename = fs.rename.bind(fs)
    const rename = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === installDir && typeof from === 'string' && from.includes('.sync-weather-')) {
        throw Object.assign(new Error('simulated activation failure'), { code: 'EIO' })
      }
      return realRename(from, to)
    })

    let managed: Set<string>
    try {
      // One plugin that cannot be copied no longer rejects the pass for every other plugin.
      managed = await syncBundledMiniApps(source, home)
    } finally {
      rename.mockRestore()
    }
    expect(managed.has('weather')).toBe(true)
    expect(JSON.parse(await fs.readFile(join(installDir, 'mini-app.json'), 'utf8'))).toMatchObject({
      description: 'v1',
    })
    const [failure] = await bundledStagingFailures(source, home)
    expect(failure).toMatchObject({ name: 'weather', lastGoodCopy: true })
    expect(failure?.reason).toContain('simulated activation failure')
  })

  test('a plugin the stager could not build keeps its last good copy and reports why', async () => {
    const { source, home } = await fixture()
    const installRoot = join(home, '.localix', 'mini-apps')
    await writePlugin(source, 'weather', 'v1')
    await writePlugin(source, 'broken', 'v1')
    await syncBundledMiniApps(source, home)

    // The stager removed `broken` for a compile error and NAMED it, which a plain removal does not.
    await fs.rm(join(source, 'broken'), { recursive: true })
    await writeStagedMarker(
      source,
      { weather: await managedFingerprint(home, 'weather') },
      { unavailable: { broken: 'error: Could not resolve: "left-pad"' } },
    )
    __resetBundledSyncCache()
    const managed = await syncBundledMiniApps(source, home)

    expect(await fs.readdir(installRoot)).toContain('broken')
    expect(managed.has('broken')).toBe(true)
    expect(await bundledStagingFailures(source, home)).toEqual([
      { name: 'broken', reason: 'error: Could not resolve: "left-pad"', lastGoodCopy: true },
    ])
  })

  test('a plugin that never built is reported with no copy to fall back on', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    await writeStagedMarker(
      source,
      { weather: await managedFingerprint(home, 'weather') },
      { unavailable: { fresh: 'error: Could not resolve: "left-pad"' } },
    )
    __resetBundledSyncCache()
    await syncBundledMiniApps(source, home)

    expect(await bundledStagingFailures(source, home)).toEqual([
      { name: 'fresh', reason: 'error: Could not resolve: "left-pad"', lastGoodCopy: false },
    ])
  })

  test('a marker naming a staged plugin as unavailable is not trusted', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    const previousFingerprint = await managedFingerprint(home, 'weather')
    await writePlugin(source, 'weather', 'v2')
    await writeStagedMarker(
      source,
      { weather: previousFingerprint },
      { unavailable: { weather: 'contradiction' } },
    )

    await expectFallbackUpdate(source, home, previousFingerprint)
  })

  test('retires the previous copy instead of deleting it, and prunes retired copies only on demand', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    await writePlugin(source, 'weather', 'v2')
    __resetBundledSyncCache()

    const installed = await syncBundledMiniApps(source, home)
    expect(installed).toEqual(new Set(['weather']))
    const installRoot = join(home, '.localix/mini-apps')
    expect(
      JSON.parse(await fs.readFile(join(installRoot, 'weather/mini-app.json'), 'utf8')),
    ).toMatchObject({ description: 'v2' })

    // The v1 tree is still on disk under a `.sync-` name: a module this process imported from
    // it must not be unlinked under `bun --watch`, and discovery skips every `.sync-` entry.
    const retired = (await fs.readdir(installRoot)).filter((name) =>
      name.startsWith('.sync-retired-weather-'),
    )
    expect(retired).toHaveLength(1)
    expect(
      JSON.parse(await fs.readFile(join(installRoot, retired[0], 'mini-app.json'), 'utf8')),
    ).toMatchObject({ description: 'v1' })

    // A later sync in the same process leaves it alone; the sweep is an explicit start-of-process act.
    await writePlugin(source, 'weather', 'v3')
    __resetBundledSyncCache()
    await syncBundledMiniApps(source, home)
    expect(
      (await fs.readdir(installRoot)).filter((name) => name.startsWith('.sync-retired-weather-')),
    ).toHaveLength(2)
    expect(await pruneRetiredManagedCopies(installRoot)).toBe(2)
    expect((await fs.readdir(installRoot)).filter((name) => name.startsWith('.sync-'))).toEqual([])
    expect(
      JSON.parse(await fs.readFile(join(installRoot, 'weather/mini-app.json'), 'utf8')),
    ).toMatchObject({ description: 'v3' })
  })

  test('detects same-size content changes even when timestamps are preserved', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    const sourceManifest = join(source, 'weather/mini-app.json')
    const writtenStat = await fs.stat(sourceManifest)
    const fixedMtime = new Date(Math.floor(writtenStat.mtimeMs))
    await fs.utimes(sourceManifest, writtenStat.atime, fixedMtime)
    const originalStat = await fs.stat(sourceManifest)
    await syncBundledMiniApps(source, home)

    await writePlugin(source, 'weather', 'v2')
    await fs.utimes(sourceManifest, originalStat.atime, originalStat.mtime)
    const updatedStat = await fs.stat(sourceManifest)
    expect(updatedStat.size).toBe(originalStat.size)
    expect(updatedStat.mtimeMs).toBe(originalStat.mtimeMs)

    // Step past the freshness window explicitly: this test is about the CONTENT
    // check, not about how long a completed pass answers for.
    __resetBundledSyncCache()
    await syncBundledMiniApps(source, home)

    expect(
      JSON.parse(await fs.readFile(join(home, '.localix/mini-apps/weather/mini-app.json'), 'utf8')),
    ).toMatchObject({ description: 'v2' })
  })

  test('uses a current staged hash without reading the plugin tree again', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    const fingerprint = await managedFingerprint(home, 'weather')
    await writeStagedMarker(source, { weather: fingerprint })
    // The production guard deliberately treats equal filesystem timestamps as
    // ambiguous and falls back to hashing. Give this fast-path test a marker that
    // is unambiguously newer than the tree even on a coarse-timestamp filesystem.
    const stagedMarkerPath = join(source, '.localix-staged.json')
    const stagedMarkerStat = await fs.stat(stagedMarkerPath)
    await fs.utimes(
      stagedMarkerPath,
      stagedMarkerStat.atime,
      new Date(Math.ceil(stagedMarkerStat.mtimeMs) + 1_000),
    )
    __resetBundledSyncCache()

    const sourceManifest = join(source, 'weather/mini-app.json')
    const realReadFile = fs.readFile.bind(fs)
    // `fs.readFile` is overloaded and its return type narrows on `options`; a mock typed against
    // the union cannot satisfy any single overload, so the passthrough is cast at the boundary
    // rather than the whole mock being loosened.
    const readFile = spyOn(fs, 'readFile').mockImplementation((async (
      path: Parameters<typeof realReadFile>[0],
      options: Parameters<typeof realReadFile>[1],
    ) => {
      if (path === sourceManifest) throw new Error('plugin tree was read')
      return await realReadFile(path, options)
    }) as typeof fs.readFile)
    try {
      expect(await syncBundledMiniApps(source, home)).toEqual(new Set(['weather']))
    } finally {
      readFile.mockRestore()
    }
  })

  test('falls back when the staged marker is absent', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    const previousFingerprint = await managedFingerprint(home, 'weather')
    await writePlugin(source, 'weather', 'v2')

    await expectFallbackUpdate(source, home, previousFingerprint)
  })

  test('falls back when the staged marker is malformed', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    const previousFingerprint = await managedFingerprint(home, 'weather')
    await writePlugin(source, 'weather', 'v2')
    await fs.writeFile(join(source, '.localix-staged.json'), '{not json')

    await expectFallbackUpdate(source, home, previousFingerprint)
  })

  test('falls back when the staged marker uses an old schema', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    const previousFingerprint = await managedFingerprint(home, 'weather')
    await writePlugin(source, 'weather', 'v2')
    await writeStagedMarker(source, { weather: previousFingerprint }, { schemaVersion: 1 })

    await expectFallbackUpdate(source, home, previousFingerprint)
  })

  test('falls back when the staged marker is missing the plugin hash', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    const previousFingerprint = await managedFingerprint(home, 'weather')
    await writePlugin(source, 'weather', 'v2')
    await writeStagedMarker(source, {})

    await expectFallbackUpdate(source, home, previousFingerprint)
  })

  test('falls back when the staged hash differs from the managed hash on disk', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    await writePlugin(source, 'weather', 'v2')
    const stagedFingerprint = '0'.repeat(64)
    await writeStagedMarker(source, { weather: stagedFingerprint })

    await expectFallbackUpdate(source, home, stagedFingerprint)
  })

  test('falls back when the staged marker predates a plugin tree change', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)
    const previousFingerprint = await managedFingerprint(home, 'weather')
    await writeStagedMarker(source, { weather: previousFingerprint })
    await writePlugin(source, 'weather', 'v2')

    await expectFallbackUpdate(source, home, previousFingerprint)
  })

  test('a completed pass answers again instead of re-walking every tree', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'weather', 'v1')
    await syncBundledMiniApps(source, home)

    // The pass content-hashes every bundled tree — 154 MB in the packaged build.
    // A startup runs discovery ~10 times (per backend-host scope, per capability
    // snapshot, and for each catalog that reloads when the snapshot publishes),
    // and paying that walk each time put two 2.4s requests in the launch path.
    await writePlugin(source, 'weather', 'v2')
    await syncBundledMiniApps(source, home)

    expect(
      JSON.parse(await fs.readFile(join(home, '.localix/mini-apps/weather/mini-app.json'), 'utf8')),
    ).toMatchObject({ description: 'v1' })

    // ...and the window is a window, not a permanent answer: the source root is
    // writable in development, so the next pass after it re-syncs.
    __resetBundledSyncCache()
    await syncBundledMiniApps(source, home)
    expect(
      JSON.parse(await fs.readFile(join(home, '.localix/mini-apps/weather/mini-app.json'), 'utf8')),
    ).toMatchObject({ description: 'v2' })
  })

  // A deleted plugin leaves its directory behind on a developer's disk, holding only ignored
  // build output. Staged, it became an empty "managed" copy in the user's home that never left.
  test('a directory with no manifest is not a plugin; a malformed manifest still is', async () => {
    const { source, home } = await fixture()
    await fs.mkdir(join(source, 'retired', '.turbo'), { recursive: true })
    await fs.mkdir(join(source, 'broken'), { recursive: true })
    await fs.writeFile(join(source, 'broken', 'mini-app.json'), '{ not json')

    const managed = await syncBundledMiniApps(source, home)

    expect([...managed]).toEqual(['broken'])
    expect(
      await fs
        .stat(join(home, '.localix/mini-apps/retired'))
        .then(() => true)
        .catch(() => false),
    ).toBe(false)
  })

  test('skips authoring and metadata directories', async () => {
    const { source, home } = await fixture()
    await writePlugin(source, 'scaffold', 'authoring only', { private: true })
    await fs.mkdir(join(source, '.localix-plugin'), { recursive: true })

    const managed = await syncBundledMiniApps(source, home)

    expect(managed.size).toBe(0)
    expect(
      await fs
        .stat(join(home, '.localix/mini-apps/scaffold'))
        .then(() => true)
        .catch(() => false),
    ).toBe(false)
  })
})
