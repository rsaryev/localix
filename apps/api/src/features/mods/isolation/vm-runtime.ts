import type { GuestHook, HookCall, ModRuntime } from '@rsaryev/llx-plugin/mods'
import type { PluginIssue } from '@rsaryev/llx-plugin/format'
import { loadModRuntime } from '../../plugins/kit'
import { defaultElementTable, RENDER_SITE_NAMES } from '../../plugins/kit/mods'
import { errorMessage } from '../../../lib/errors'
import { startModVm, type ModVmThread, type VmClock, type VmHook } from './mod-vm'
import type { DollarApi } from './stand-in'

/**
 * The kit's `ModRuntime` over Localix's VMs: each load of a mod's hooks module runs in a QuickJS VM
 * of its own (`mod-vm.ts`), and each hook it registered comes back as a `GuestHook` whose run is a
 * call into that VM, served with the `$` and `next` the kit's chain gave the run (`HookCall.direct`).
 * The kit owns everything around the hook: the chain, budgets, re-entry, traces, failure handling.
 * A VM that held its thread or crashed is stopped; `died` tells the host, which unloads the mod.
 */

/** The run format the compiler gives the VM: CommonJS statements it evaluates as a function body. */
export const VM_FORMAT = 'cjs'

export interface VmRuntimeOptions {
  /** The thread every mod this runtime loads shares: one conversation's (`session-host.ts`). */
  vms: ModVmThread
  /** Where a bundled host keeps the mods runtime (`plugins/kit/mods/guest/runtime-file.ts`). */
  runtimeDir?: string
  /** An unsettled `register`, or a turn that holds the VM's thread, for this long: the VM goes. */
  hangMs: number
  memoryLimitBytes: number
  clock: VmClock
  /** What a mod's VM reports and survives (an unhandled rejection), by plugin. */
  report: (plugin: string, message: string) => void
  print?: (level: 'log' | 'error', line: string) => void
  /** A loaded mod's VM held its thread or crashed, and is stopped. */
  died: (plugin: string, reason: string) => void
}

const issue = (path: string, message: string): PluginIssue => ({
  severity: 'error',
  path,
  message: `${path}: ${message}`,
})

/** `$` as plain namespaces, as the VM's channel reads it. */
const dollarOf = (api: object): DollarApi => Object.fromEntries(Object.entries(api))

/**
 * The elements other mods restyled for each render site, as `ui.resolve` left them for the mod when
 * it loaded, read through the host's `$`: the VM draws the kit's own elements itself, at once, and
 * calls back here only for a restyled one.
 */
function restyledOf($: DollarApi): Map<string, Record<string, unknown>> {
  const ui = $.ui as { resolve?: (e: unknown) => Record<string, unknown> } | undefined
  const own = defaultElementTable('desktop') as Record<string, unknown>
  const tables = new Map<string, Record<string, unknown>>()
  for (const component of RENDER_SITE_NAMES) {
    const table = ui?.resolve?.({ surface: 'desktop', component }) ?? {}
    const changed = Object.entries(table).filter(([name, element]) => own[name] !== element)
    if (changed.length > 0) tables.set(component, Object.fromEntries(changed))
  }
  return tables
}

/** The `$` and `next` of a run; a kit that sends none cannot run a hook in a VM. */
function directOf(call: HookCall) {
  if (!call.direct) throw new Error('the chain gave the hook no $ and next to serve it with')
  return { $: dollarOf(call.direct.$), next: call.direct.next }
}

function guestHook(hook: VmHook, seen: (api: DollarApi) => void): GuestHook {
  const run = (call: HookCall, standIn: NonNullable<VmHook['catch']>) => {
    const { $, next } = directOf(call)
    seen($)
    return standIn($, call.event, next)
  }
  const handler = hook.catch
  return {
    event: hook.event,
    ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
    kind: hook.generator ? 'generator' : 'function',
    hasCatch: handler !== undefined,
    run: (call) => run(call, hook.run),
    ...(handler ? { runCatch: (call) => Promise.resolve(run(call, handler)) } : {}),
  }
}

export function createVmRuntime(options: VmRuntimeOptions): ModRuntime {
  return {
    async load(input, signal) {
      if (input.format !== VM_FORMAT)
        return { issues: [issue(input.entry, `a VM runs ${VM_FORMAT}, not ${input.format}`)] }
      let loaded = false
      /** The `$` of the latest run, for a call a closure makes after its hook ended. */
      let latest: DollarApi | undefined
      const vm = startModVm({
        vms: options.vms,
        runtime: await loadModRuntime(options.runtimeDir),
        code: input.code,
        name: `${input.plugin}/${input.entry}`,
        plugin: input.plugin,
        hangMs: options.hangMs,
        memoryLimitBytes: options.memoryLimitBytes,
        clock: options.clock,
        apiOf: () => latest,
        report: (message) => options.report(input.plugin, message),
        ...(options.print ? { print: options.print } : {}),
        onDeath: (reason) => void (loaded && options.died(input.plugin, reason)),
      })
      const stop = () => vm.stop()
      signal.addEventListener('abort', stop, { once: true })
      try {
        const hooks = await vm.load(input.options)
        loaded = true
        const remember = (api: DollarApi) => {
          // The first run comes once the mod loaded and its tables were resolved: the VM gets them.
          if (!latest) vm.setTables(restyledOf(api))
          latest = api
        }
        return {
          module: {
            hooks: hooks.map((hook) => guestHook(hook, remember)),
            dispose: () => Promise.resolve(vm.stop()),
          },
          issues: [],
        }
      } catch (error) {
        vm.stop()
        return { issues: [issue(input.entry, errorMessage(error))] }
      } finally {
        signal.removeEventListener('abort', stop)
      }
    },
  }
}
