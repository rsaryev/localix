import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isWorkbenchMiniApp } from '@localixai/mini-app-sdk/manifest'
import { discoverBundledMiniApps } from './discovery'
import { resolvePluginConfig } from './config'
import { inspectMiniAppTools } from './native'
import { validatePluginFull } from './validate'
import { assertNotVoid } from '../../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Native bundled UI is discovered by a generic Vite glob, while product grouping is
 * driven by manifest surfaces. Keep those independent layers declaratively aligned.
 */
describe('bundled plugin surface contract', () => {
  it('keeps native UI entrypoints and the workbench surface in sync without an allowlist', async () => {
    const plugins = await discoverBundledMiniApps()
    // ANTI-VOID. Every assertion below compares a list DERIVED from discovery against
    // `[]`, so an empty discovery makes all of them pass while inspecting nothing —
    // proven: with `plugins = []`, `mismatches` and `failures` are both `[]`. Same
    // reasoning (and same helper) as composition-root-contract.test.ts.
    assertNotVoid(
      'bundled plugins',
      plugins.length,
      'discoverBundledMiniApps() walks plugins/*/plugin.json — check the glob and directory layout.',
    )
    const mismatches: string[] = []

    await Promise.all(
      plugins.map(async (plugin) => {
        const hasNativeUi =
          (await exists(join(plugin.dir, 'ui', 'register.ts'))) ||
          (await exists(join(plugin.dir, 'ui', 'register.tsx')))
        const declaresWorkbench = isWorkbenchMiniApp(plugin.manifest.surfaces)
        if (hasNativeUi !== declaresWorkbench) {
          mismatches.push(
            `${plugin.manifest.name}: ui/register=${hasNativeUi}, workbench=${declaresWorkbench}`,
          )
        }
      }),
    )

    expect(mismatches.sort()).toEqual([])
  })

  it('strict-validates every installable bundled plugin', async () => {
    const plugins = await discoverBundledMiniApps()
    assertNotVoid(
      'bundled plugins to validate',
      plugins.length,
      'discoverBundledMiniApps() walks plugins/*/plugin.json — check the glob and directory layout.',
    )
    const results = await Promise.all(
      plugins.map(async (plugin) => ({
        name: plugin.manifest.name,
        validation: await validatePluginFull(plugin, { strict: true }),
      })),
    )
    const failures = results.flatMap(({ name, validation }) =>
      validation.errors.map((error) => `${name}: ${error}`),
    )
    expect(failures).toEqual([])
  })

  it('imports and registers every native bundled entrypoint without errors', async () => {
    const plugins = (await discoverBundledMiniApps()).filter(
      (plugin) => plugin.provides.hasNativeTools,
    )
    assertNotVoid(
      'bundled plugins with native tools',
      plugins.length,
      'Also check `provides.hasNativeTools` — the filter above depends on it.',
    )
    const results = await Promise.all(
      plugins.map(async (plugin) => ({
        name: plugin.manifest.name,
        result: await inspectMiniAppTools(plugin, resolvePluginConfig(plugin.manifest, undefined), {
          // Inspection builds a real context, which creates the plugin's roots: never the real home.
          homeDir: join(tmpdir(), 'localix-bundled-surfaces-home'),
        }),
      })),
    )
    expect(
      results.flatMap(({ name, result }) => (result.error ? [`${name}: ${result.error}`] : [])),
    ).toEqual([])
    expect(
      results.flatMap(({ name, result }) =>
        result.tools.flatMap((tool) => [
          ...(!tool.name ? [`${name}: tool has no name`] : []),
          ...(!tool.label ? [`${name}/${tool.name}: tool has no UI label`] : []),
          ...(!tool.description ? [`${name}/${tool.name}: tool has no description`] : []),
        ]),
      ),
    ).toEqual([])

    const owned = (plugin: string, identities: string[]): Array<[string, string]> =>
      identities.map((identity) => [identity, plugin])
    const identityGroups = {
      tool: results.flatMap(({ name, result }) =>
        owned(
          name,
          result.tools.map((tool) => tool.name),
        ),
      ),
      backend: results.flatMap(({ name, result }) => owned(name, result.backendSubsystems)),
      route: results.flatMap(({ name, result }) => owned(name, result.routeMounts)),
      resource: results.flatMap(({ name, result }) => owned(name, result.resourceProviders)),
      search: results.flatMap(({ name, result }) => owned(name, result.searchProviders)),
      context: results.flatMap(({ name, result }) => owned(name, result.contextProviders)),
      websocket: results.flatMap(({ name, result }) => owned(name, result.wsCommands)),
      channel: results.flatMap(({ name, result }) => owned(name, result.channels)),
    } satisfies Record<string, Array<[identity: string, plugin: string]>>
    const collisions = Object.entries(identityGroups).flatMap(([kind, identities]) => {
      const owners = new Map<string, string>()
      return identities.flatMap(([identity, plugin]) => {
        const owner = owners.get(identity)
        if (!owner) {
          owners.set(identity, plugin)
          return []
        }
        return [`${kind} ${identity}: ${owner}, ${plugin}`]
      })
    })
    expect(collisions).toEqual([])
    const ownerNamespaceFailures = (['backend', 'search', 'context', 'websocket'] as const).flatMap(
      (kind) =>
        identityGroups[kind].flatMap(([identity, plugin]) =>
          identity.startsWith(`${plugin}:`)
            ? []
            : [`${kind} ${identity} is not namespaced by owner ${plugin}:`],
        ),
    )
    expect(ownerNamespaceFailures).toEqual([])
    expect(results.flatMap(({ result }) => result.routeMounts)).toSatisfy((routes: string[]) =>
      routes.every((route) => route.startsWith('/rpc/')),
    )
  })
})
