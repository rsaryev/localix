import { join } from 'node:path'
import type { BudgetClock, ModsApi, RegisterFunction } from '@localixai/claude-plugin/mods'
import { bundleClientModules, type ClientBundle } from './client-modules'
import type { ModSource, ModsPorts } from './contracts'
import { loadModRuntime } from './isolation/guest-file'
import { startModVm, type ModVm, type ModVmPort } from './isolation/mod-vm'
import { bundleHooksModule, clearHooksCopies } from './module-build'
import { SUPERVISOR_CLOCK, type RestartRules } from './restarts'

/**
 * One load of a plugin's hooks module for one instance: its bundle, sent to a VM of its own
 * (`isolation/`), whose only door is `$`. Nothing is written to disk for it. A test may run the
 * module in this process instead (`build`), with hooks it registers itself.
 */

/** How the host runs hooks modules (`ModsHostOptions`). */
export interface HooksOptions {
  /** Runs one load of a plugin's hooks module in this process; tests supply their own. */
  build?: (source: ModSource, load: string) => Promise<RegisterFunction>
  /** Where each instance's VM comes from; without it (and `build`), no mod loads. */
  vms?: ModVmPort
  /** Where a bundled host keeps the mods runtime (`isolation/guest-file.ts`). */
  runtimeDir?: string
  /** The hook budget, 10 s: a mod whose VM loads or holds its thread longer is stopped. */
  hangMs?: number
  /** Each instance's heap, 128 MiB: an allocation past it fails inside the VM. */
  memoryLimitBytes?: number
  /** Where mods' `console` lines go, cut and bounded; this process's console by default. */
  print?: (level: 'log' | 'error', line: string) => void
  /** The clock loads are timed and mods restarted on; tests drive their own. */
  clock?: BudgetClock
  /** How often a mod's VM may die before the mod stays stopped (`restarts.ts`). */
  restarts?: Partial<RestartRules>
}

export interface HooksLoaderInput extends HooksOptions {
  ports: ModsPorts
  /** The instance's `$`, for a call its closures make outside any hook run. */
  apiOf: (id: string) => ModsApi | undefined
  /** The instance's VM held its thread or crashed, and is stopped. */
  died: (id: string, vm: ModVm, reason: string) => void
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
  vm?: ModVm
}

const DEFAULT_MEMORY_LIMIT = 128 * 1024 * 1024

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
    if (!input.vms) throw new Error('this host runs no mods: it has no VM to run them in')
    const { plugin } = loaded.source
    const vm: ModVm = startModVm({
      vms: input.vms,
      runtime: await loadModRuntime(input.runtimeDir),
      code: loaded.code,
      name: `${plugin}/hooks.cjs`,
      hangMs: input.hangMs ?? 10_000,
      memoryLimitBytes: input.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT,
      clock,
      apiOf: () => input.apiOf(id),
      report: (message) => input.ports.report(plugin, message),
      ...(input.print ? { print: input.print } : {}),
      onDeath: (reason) => input.died(id, vm, reason),
    })
    return { register: vm.register, vm }
  }

  return { bundle, load }
}
