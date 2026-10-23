import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isWorkbenchMiniApp } from '@localixai/mini-app-sdk/manifest'
import { resolveMiniAppConfig } from './config'
import { discoverBundledMiniApps } from './discovery'
import { inspectMiniAppTools } from './native'
import { validateMiniApp } from './validate'
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
describe('bundled mini app surface contract', () => {
  it('keeps native UI entrypoints and the workbench surface in sync without an allowlist', async () => {
    const apps = await discoverBundledMiniApps()
    // ANTI-VOID. Every assertion below compares a list DERIVED from discovery against
    // `[]`, so an empty discovery makes all of them pass while inspecting nothing —
    // proven: with `apps = []`, `mismatches` and `failures` are both `[]`. Same
    // reasoning (and same helper) as composition-root-contract.test.ts.
    assertNotVoid(
      'bundled mini apps',
      apps.length,
      'discoverBundledMiniApps() walks mini-apps/*/mini-app.json — check the glob and directory layout.',
    )
    const mismatches: string[] = []

    await Promise.all(
      apps.map(async (app) => {
        const hasNativeUi =
          (await exists(join(app.dir, 'ui', 'register.ts'))) ||
          (await exists(join(app.dir, 'ui', 'register.tsx')))
        const declaresWorkbench = isWorkbenchMiniApp(app.manifest?.surfaces)
        if (hasNativeUi !== declaresWorkbench) {
          mismatches.push(`${app.name}: ui/register=${hasNativeUi}, workbench=${declaresWorkbench}`)
        }
      }),
    )

    expect(mismatches.sort()).toEqual([])
  })

  it('validates every installable bundled mini app', async () => {
    const apps = await discoverBundledMiniApps()
    assertNotVoid(
      'bundled mini apps to validate',
      apps.length,
      'discoverBundledMiniApps() walks mini-apps/*/mini-app.json — check the glob and directory layout.',
    )
    const results = apps.map((app) => ({ name: app.name, validation: validateMiniApp(app) }))
    const failures = results.flatMap(({ name, validation }) =>
      validation.errors.map((error) => `${name}: ${error}`),
    )
    expect(failures).toEqual([])
  })

  it('imports and registers every native bundled entrypoint without errors', async () => {
    const apps = (await discoverBundledMiniApps()).filter((app) => app.backendEntries.length > 0)
    assertNotVoid(
      'bundled mini apps with a backend',
      apps.length,
      'Also check `backendEntries` — the filter above depends on it.',
    )
    const results = await Promise.all(
      apps.map(async (app) => ({
        name: app.name,
        result: await inspectMiniAppTools(
          app,
          resolveMiniAppConfig(app.manifest?.config, undefined),
          {
            // Inspection builds a real context, which creates the app's roots: never the real home.
            homeDir: join(tmpdir(), 'localix-bundled-surfaces-home'),
          },
        ),
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

    const owned = (app: string, identities: string[]): Array<[string, string]> =>
      identities.map((identity) => [identity, app])
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
    } satisfies Record<string, Array<[identity: string, app: string]>>
    const collisions = Object.entries(identityGroups).flatMap(([kind, identities]) => {
      const owners = new Map<string, string>()
      return identities.flatMap(([identity, app]) => {
        const owner = owners.get(identity)
        if (!owner) {
          owners.set(identity, app)
          return []
        }
        return [`${kind} ${identity}: ${owner}, ${app}`]
      })
    })
    expect(collisions).toEqual([])
    const ownerNamespaceFailures = (['backend', 'search', 'context', 'websocket'] as const).flatMap(
      (kind) =>
        identityGroups[kind].flatMap(([identity, app]) =>
          identity.startsWith(`${app}:`)
            ? []
            : [`${kind} ${identity} is not namespaced by owner ${app}:`],
        ),
    )
    expect(ownerNamespaceFailures).toEqual([])
    expect(results.flatMap(({ result }) => result.routeMounts)).toSatisfy((routes: string[]) =>
      routes.every((route) => route.startsWith('/rpc/')),
    )
  })
})
