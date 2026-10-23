import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { DiscoveredPlugin } from '../discovery'
import { createMiniAppAuthoring, UserMiniAppNotFoundError } from './service'

// Building a plugin runs its code: Bun.build over its entries and `bun test` over its test files.
// The authoring markers are files the plugin itself ships, so they cannot say the plugin is the
// user's own. Only an allowed plugin under the user's plugins root is built; a Claude Code install
// or an in-place one is never written to or run from here.

const tempDir = tempDirPerTest('plugin-build-consent-')

type Origin = 'home' | 'claude-code' | 'in-place' | 'elsewhere'

function stage(root: string, name: string, origin: Origin): DiscoveredPlugin {
  const dir =
    origin === 'elsewhere' ? join(root, 'other', name) : join(root, 'home/.localix/plugins', name)
  writeTree(dir, {
    '.claude-plugin/plugin.json': JSON.stringify({ name }),
    'ui/register.tsx': 'export {}\n',
    'a.test.ts': 'export {}\n',
  })
  return {
    manifest: { name },
    dir,
    scope: 'global',
    projectId: '',
    bundled: false,
    ...(origin === 'claude-code' ? { claudeCodeInstall: `${name}@m` } : {}),
    ...(origin === 'in-place' ? { inPlaceInstall: `${name}@m` } : {}),
  } as unknown as DiscoveredPlugin
}

function harness(plugins: DiscoveredPlugin[], allowed: ReadonlySet<string>) {
  const root = tempDir()
  const kitReads: string[] = []
  const tested: string[] = []
  const authoring = createMiniAppAuthoring({
    discover: async () => plugins,
    pluginsRoot: join(root, 'home/.localix/plugins'),
    kitDir: () => {
      kitReads.push('kit')
      return join(root, 'no-kit')
    },
    allowed: async (_userId, plugin) => allowed.has(plugin.manifest.name),
    enable: async () => undefined,
    changed: () => undefined,
    runTests: async ({ pluginDir }) => {
      tested.push(pluginDir)
      return { ok: true, output: '' }
    },
  } as Parameters<typeof createMiniAppAuthoring>[0])
  return { authoring, kitReads, tested }
}

describe('plugin authoring builds only consented plugins of the user', () => {
  it('rebuildAll skips a plugin nobody allowed and installs it does not own', async () => {
    const root = tempDir()
    const plugins = [
      stage(root, 'unconsented', 'home'),
      stage(root, 'cc-install', 'claude-code'),
      stage(root, 'in-place', 'in-place'),
      stage(root, 'outside-root', 'elsewhere'),
    ]
    const { authoring, kitReads, tested } = harness(
      plugins,
      new Set(['cc-install', 'in-place', 'outside-root']),
    )

    expect(await authoring.rebuildAll('u1')).toEqual([])
    expect(kitReads).toEqual([])
    expect(tested).toEqual([])
  })

  it('build refuses a plugin nobody allowed before running anything of it', async () => {
    const root = tempDir()
    const { authoring, kitReads } = harness([stage(root, 'unconsented', 'home')], new Set())

    await expect(authoring.build('u1', 'unconsented')).rejects.toBeInstanceOf(
      UserMiniAppNotFoundError,
    )
    expect(kitReads).toEqual([])
  })

  it('build refuses a Claude Code install even when it is allowed', async () => {
    const root = tempDir()
    const { authoring, kitReads } = harness(
      [stage(root, 'cc-install', 'claude-code')],
      new Set(['cc-install']),
    )

    await expect(authoring.build('u1', 'cc-install')).rejects.toBeInstanceOf(
      UserMiniAppNotFoundError,
    )
    expect(kitReads).toEqual([])
  })

  it('still builds an allowed plugin of the user', async () => {
    const root = tempDir()
    const { authoring, kitReads } = harness([stage(root, 'mine', 'home')], new Set(['mine']))

    // No kit is staged, so the build fails at the kit — after it was chosen to be built.
    await expect(authoring.rebuildAll('u1')).rejects.toThrow()
    expect(kitReads).toEqual(['kit'])
  })
})
