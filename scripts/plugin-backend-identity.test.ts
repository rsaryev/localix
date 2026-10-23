import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverBundledMiniApps } from '../apps/api/src/features/mini-apps/discovery'
import { miniAppBackendIdentityProblems } from '../apps/api/src/features/mini-apps/backend-host-plan'
import { inspectMiniAppTools } from '../apps/api/src/features/mini-apps/native'
import { resolveMiniAppConfig } from '../apps/api/src/features/mini-apps/config'
import type { MiniAppHostServices } from '@localixai/mini-app-sdk/backend'

/**
 * A host that says yes to everything, so a plugin gets as far as declaring its contributions.
 *
 * The point is what it is NOT: a fixed object listing the services that exist today. A plugin
 * decides whether to contribute by probing the host — one of them checks twelve methods and
 * disables an entire surface if a single one is missing — and a fixture that enumerates them goes
 * stale the moment a seam is added, silently reverting this test to "nothing to check". A proxy
 * answers every probe, so what is asserted below is the plugin's own naming and nothing about the
 * host's shape.
 *
 * It is only ever asked for identities. Nothing here is called.
 */
function permissiveHost(): MiniAppHostServices {
  const yes = (): unknown =>
    new Proxy(() => undefined, {
      apply: () => Promise.resolve(null),
      get: (_target, key) => (key === 'then' ? undefined : yes()),
    })
  return new Proxy({} as MiniAppHostServices, {
    get: (_target, key) => (key === 'then' ? undefined : yes()),
    has: () => true,
  })
}

/**
 * Every identity a bundled plugin's backend registers must be namespaced by its manifest name.
 *
 * The rule already exists — {@link miniAppBackendIdentityProblems} is what the backend host applies
 * at wire time — but its only consequence there is a log line and a subsystem that contributes
 * nothing. A plugin shipped with its bare manifest name as a subsystem id (no colon) and was
 * rejected on every boot for as long as core happened to mount the same routes itself. The day
 * core stopped, its panel answered "Route not found", and the reason was a warn nobody reads.
 *
 * So the rule is checked here, against the SAME function, before it can reach a user.
 */
describe('bundled plugin backend identities', () => {
  test('every registered identity is namespaced by its owning plugin', async () => {
    const bundled = (await discoverBundledMiniApps()).filter(
      (plugin) => plugin.backendEntries.length > 0,
    )
    // A scan that reaches nothing is a disabled lint: an empty problem list looks exactly like a
    // clean tree. The bundled set is a dozen-plus plugins; a handful means the walk broke.
    expect(bundled.length).toBeGreaterThan(5)

    const host = permissiveHost()
    const problems: string[] = []
    const contributors: string[] = []
    for (const plugin of bundled) {
      const inspection = await inspectMiniAppTools(
        plugin,
        resolveMiniAppConfig(plugin.manifest?.config, undefined),
        // A fixture home: a real context creates the plugin's roots.
        {
          userId: 'identity-audit',
          cwd: plugin.dir,
          host,
          homeDir: join(tmpdir(), 'localix-identity-audit-home'),
        },
      )
      if (inspection.backendSubsystems.length > 0) contributors.push(plugin.name)
      for (const id of inspection.backendSubsystems) {
        problems.push(
          ...miniAppBackendIdentityProblems(plugin.name, { id } as never).map(
            (problem) => `${plugin.name}: ${problem}`,
          ),
        )
      }
      for (const id of inspection.contextProviders) {
        // The subsystem id here is a stand-in that already satisfies the rule: this pass is asking
        // only about the CONTEXT PROVIDER's name, and the subsystem ids were checked above.
        problems.push(
          ...miniAppBackendIdentityProblems(plugin.name, {
            id: `${plugin.name}:audit`,
            contextProviders: [{ provider: { id } }],
          } as never).map((problem) => `${plugin.name}: ${problem}`),
        )
      }
      for (const command of inspection.wsCommands) {
        problems.push(
          ...miniAppBackendIdentityProblems(plugin.name, {
            id: `${plugin.name}:audit`,
            wsFrames: [{ subscribeCommand: command, unsubscribeCommand: command }],
          } as never).map((problem) => `${plugin.name}: ${problem}`),
        )
      }
    }

    expect(problems).toEqual([])
    // The host is what makes a service-dependent plugin declare anything at all. If this drops to
    // the plugins that need no host, the proxy stopped satisfying a probe and the test above went
    // quiet without failing.
    expect(contributors.length).toBeGreaterThan(5)
  })
})
