import { join } from 'node:path'
import type { BudgetClock, ModsApi, RegisterFunction } from '@localixai/claude-plugin/mods'
import { bundleClientModules, type ClientBundle } from './client-modules'
import type { ModSource, ModsPorts } from './contracts'
import { startModWorker, type ModWorker } from './isolation/mod-worker'
import { SUPERVISOR_CLOCK } from './isolation/watchdog'
import { modWorkerUrl } from './isolation/worker-file'
import { bundleHooksModule, clearHooksCopies } from './module-build'
import type { RestartRules } from './restarts'

/**
 * One load of a plugin's hooks module for one instance: its bundle, sent to a worker of its own
 * (`isolation/`), whose only door is `$`. Nothing is written to disk for it. A test may run the
 * module in this process instead (`build`), with hooks it registers itself.
 */

/** How the host runs hooks modules (`ModsHostOptions`). */
export interface HooksOptions {
  /** Runs one load of a plugin's hooks module in this process; tests supply their own. */
  build?: (source: ModSource, load: string) => Promise<RegisterFunction>
  /** The hook budget, 10 s: a mod's worker that loads or holds its thread longer is stopped. */
  hangMs?: number
  /** The worker a mod instance runs in (`isolation/worker-file.ts`). */
  workerUrl?: string | URL
  /** The clock mods' workers are watched and restarted on; tests drive their own. */
  clock?: BudgetClock
  /** How often a mod's worker may die before the mod stays stopped (`restarts.ts`). */
  restarts?: Partial<RestartRules>
}

export interface HooksLoaderInput extends HooksOptions {
  ports: ModsPorts
  /** The instance's `$`, for a call its closures make outside any hook run. */
  apiOf: (id: string) => ModsApi | undefined
  /** The instance's worker hung, crashed, exited or was stopped, and is terminated. */
  died: (id: string, worker: ModWorker, reason: string) => void
}

/** A plugin's mod as each of its loads runs it: its bundle, and the surface modules it names. */
export interface LoadedMod {
  source: ModSource
  code: string
  clients: Map<string, ClientBundle>
}

export interface LoadedHooks {
  register: RegisterFunction
  /** Absent when the module runs in this process (`build`). */
  worker?: ModWorker
}

export function createHooksLoader(input: HooksLoaderInput) {
  let loads = 0
  const cleared = new Set<string>()
  const clock = input.clock ?? SUPERVISOR_CLOCK

  /** Bundles the plugin's mod once; the copies earlier versions wrote to disk go. */
  async function bundle(source: ModSource): Promise<LoadedMod> {
    const found = new Set<string>()
    const code = input.build ? '' : await bundleHooksModule(source, { clients: found })
    const clients = await bundleClientModules(source.root, found)
    if (!input.build && !cleared.has(source.plugin)) {
      cleared.add(source.plugin)
      await clearHooksCopies(join(input.ports.dataDir(source.plugin), 'mod'))
    }
    return { source, code, clients }
  }

  async function load(loaded: LoadedMod, id: string): Promise<LoadedHooks> {
    const load = `${id}-${++loads}`
    if (input.build) return { register: await input.build(loaded.source, load) }
    const { plugin } = loaded.source
    const worker: ModWorker = startModWorker({
      code: loaded.code,
      name: `${plugin}/hooks.cjs`,
      workerUrl: input.workerUrl ?? modWorkerUrl(),
      hangMs: input.hangMs ?? 10_000,
      clock,
      apiOf: () => input.apiOf(id),
      report: (message) => input.ports.report(plugin, message),
      onDeath: (reason) => input.died(id, worker, reason),
    })
    return { register: worker.register, worker }
  }

  return { bundle, load }
}
