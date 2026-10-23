import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { DiscoveredMiniApp } from '../discovery'
import { createMiniAppAuthoring, UserMiniAppNotFoundError } from './service'

// Building a mini app runs its code: Bun.build over its entries and `bun test` over its test files.
// The authoring markers are files the mini app itself ships, so they cannot say the mini app is the
// user's own. Only an allowed mini app under the user's mini apps root is built; a managed copy of
// one Localix ships, or a folder elsewhere, is never written to or run from here.

const tempDir = tempDirPerTest('mini-app-build-consent-')

type Origin = 'home' | 'bundled' | 'elsewhere'

function stage(root: string, name: string, origin: Origin): DiscoveredMiniApp {
  const dir =
    origin === 'elsewhere' ? join(root, 'other', name) : join(root, 'home/.localix/mini-apps', name)
  writeTree(dir, {
    'mini-app.json': JSON.stringify({ name }),
    'ui/register.tsx': 'export {}\n',
    'a.test.ts': 'export {}\n',
  })
  return {
    name,
    manifest: { name },
    dir,
    scope: 'global',
    projectId: '',
    bundled: origin === 'bundled',
    backendEntries: [],
    views: [],
    promptSections: [],
    contributions: [],
    commands: [],
  } as unknown as DiscoveredMiniApp
}

function harness(apps: DiscoveredMiniApp[], allowed: ReadonlySet<string>) {
  const root = tempDir()
  const kitReads: string[] = []
  const tested: string[] = []
  const authoring = createMiniAppAuthoring({
    discover: async () => apps,
    pluginsRoot: join(root, 'home/.localix/mini-apps'),
    kitDir: () => {
      kitReads.push('kit')
      return join(root, 'no-kit')
    },
    allowed: async (_userId, app) => allowed.has(app.name),
    enable: async () => undefined,
    changed: () => undefined,
    runTests: async ({ pluginDir }) => {
      tested.push(pluginDir)
      return { ok: true, output: '' }
    },
  } as Parameters<typeof createMiniAppAuthoring>[0])
  return { authoring, kitReads, tested }
}

describe('mini app authoring builds only consented mini apps of the user', () => {
  it('rebuildAll skips a mini app nobody allowed and copies it does not own', async () => {
    const root = tempDir()
    const apps = [
      stage(root, 'unconsented', 'home'),
      stage(root, 'shipped', 'bundled'),
      stage(root, 'outside-root', 'elsewhere'),
    ]
    const { authoring, kitReads, tested } = harness(apps, new Set(['shipped', 'outside-root']))

    expect(await authoring.rebuildAll('u1')).toEqual([])
    expect(kitReads).toEqual([])
    expect(tested).toEqual([])
  })

  it('build refuses a mini app nobody allowed before running anything of it', async () => {
    const root = tempDir()
    const { authoring, kitReads } = harness([stage(root, 'unconsented', 'home')], new Set())

    await expect(authoring.build('u1', 'unconsented')).rejects.toBeInstanceOf(
      UserMiniAppNotFoundError,
    )
    expect(kitReads).toEqual([])
  })

  it('build refuses a managed copy of a shipped mini app even when it is allowed', async () => {
    const root = tempDir()
    const { authoring, kitReads } = harness(
      [stage(root, 'shipped', 'bundled')],
      new Set(['shipped']),
    )

    await expect(authoring.build('u1', 'shipped')).rejects.toBeInstanceOf(UserMiniAppNotFoundError)
    expect(kitReads).toEqual([])
  })

  it('still builds an allowed mini app of the user', async () => {
    const root = tempDir()
    const { authoring, kitReads } = harness([stage(root, 'mine', 'home')], new Set(['mine']))

    // No kit is staged, so the build fails at the kit — after it was chosen to be built.
    await expect(authoring.rebuildAll('u1')).rejects.toThrow()
    expect(kitReads).toEqual(['kit'])
  })
})
