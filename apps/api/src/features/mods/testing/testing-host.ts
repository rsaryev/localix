import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import type { ModRuntime } from '@rsaryev/llx-plugin/mods'
import { modsTesting } from '../../plugins/kit/testing'
import { INERT_MOD_PORTS, type ModScene, type ModsPorts } from '../contracts'
import { createModsHost } from '../host'
import { NO_MOD_VMS } from '../isolation/mod-vm'
import { createModRunScope } from '../run-scope'

/**
 * A mods host for tests with one mod, `m`, whose hooks the test registers directly, and a run
 * scope for its conversation `s1`. Each mod is a plugin on disk whose hooks module the kit's
 * `inlineRuntime` runs in this process. Shared by the event tests; not a test itself.
 */

/** A test's hook, `($, e, next)`, its arguments left untyped as a test writes them. */
// oxlint-disable-next-line typescript/no-explicit-any -- a test's hook reads any event's fields
export type TestHook = (...args: any[]) => unknown
/** `on(event, hook)` and `on(event, matcher, hook)`, as a hooks module's `register` gets it. */
export type On = (
  event: string,
  matcherOrHook: object | TestHook,
  hook?: TestHook,
) => { catch(handler: TestHook): void }

const scratch = tempDirPerTest('mods-events', {})

/** One runtime for several mods: each plugin's `register`, by the plugin's name. */
function inlineMods(mods: Record<string, (on: On) => void>): ModRuntime {
  return {
    load(input, signal) {
      const register = mods[input.plugin.replace(/@inline$/, '')]
      if (!register) return Promise.resolve({ issues: [] })
      return modsTesting.inlineRuntime((on) => register(on as On)).load(input, signal)
    },
  }
}

export async function hostWithMod(register: (on: On) => void, ports: Partial<ModsPorts> = {}) {
  return hostWithMods({ m: register }, ports)
}

/** Several mods, each its own plugin, loaded in the order given, as `hostWithMod` loads one. */
export async function hostWithMods(
  mods: Record<string, (on: On) => void>,
  ports: Partial<ModsPorts> = {},
) {
  const dir = scratch()
  const reports: string[] = []
  const host = createModsHost(
    {
      ...INERT_MOD_PORTS,
      dataDir: (plugin) => join(dir, 'data', plugin),
      workspaceDir: dir,
      report: (plugin, message) => reports.push(`${plugin}: ${message}`),
      ...ports,
    },
    { vms: NO_MOD_VMS, homeDir: dir, managed: null, runtime: inlineMods(mods) },
  )
  await host.reconcile(
    Object.keys(mods).map((plugin) => {
      const root = join(dir, 'plugins', plugin)
      writeTree(root, {
        '.claude-plugin/plugin.json': JSON.stringify({ name: plugin, version: '1.0.0' }),
        'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),
        'hooks/register.js': 'export function register() {}\n',
      })
      return { plugin, root, module: join(root, 'hooks/register.js'), options: {}, revision: '1' }
    }),
  )
  const scene: ModScene = { userId: 'u', sessionId: 's1', cwd: dir }
  const scope = await createModRunScope(host, scene, new Set(Object.keys(mods)), {
    model: 'model-a',
  })
  return { host, scope, scene, dir, reports }
}
