import { tempDirPerTest } from '@localixai/testing'
import type { On } from '@localixai/claude-plugin/mods'
import { INERT_MOD_PORTS, type ModScene, type ModsPorts } from './contracts'
import { createModsHost } from './host'
import { createModRunScope } from './run-scope'

/**
 * A mods host for tests with one mod, `m`, whose hooks the test registers directly, and a run
 * scope for its conversation `s1`. Shared by the event tests; not a test itself.
 */

const scratch = tempDirPerTest('mods-events', {})

export async function hostWithMod(register: (on: On) => void, ports: Partial<ModsPorts> = {}) {
  const dir = scratch()
  const reports: string[] = []
  const host = createModsHost(
    {
      ...INERT_MOD_PORTS,
      dataDir: (plugin) => `${dir}/${plugin}`,
      workspaceDir: dir,
      report: (plugin, message) => reports.push(`${plugin}: ${message}`),
      ...ports,
    },
    { build: async () => (on) => register(on) },
  )
  await host.reconcile([
    { plugin: 'm', root: dir, module: `${dir}/hooks/m.js`, options: {}, revision: '1' },
  ])
  const scene: ModScene = { userId: 'u', sessionId: 's1', cwd: dir }
  const scope = await createModRunScope(host, scene, new Set(['m']), { model: 'model-a' })
  return { host, scope, scene, dir, reports }
}
