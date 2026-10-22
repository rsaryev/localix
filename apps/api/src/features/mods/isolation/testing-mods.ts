import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { INERT_MOD_PORTS, type ModScene, type ModSource } from '../contracts'
import { createModsHost, type ModsHostOptions } from '../host'
import type { ModVmPort } from './mod-vm'

/**
 * A mods host running real hooks modules, each in its VM, for the isolation tests: mods by name
 * and source, what they report, log and print, and a wait for a report. The test hands it the VMs
 * (`createScriptVms` of `@localixai/engine-scripts`). Not a test itself.
 */

const scratch = tempDirPerTest('mods-isolation', {})

/**
 * A clock that moves only when a test says so: `advance` fires what fell due, `armed(ms)` waits
 * until a timer of `ms` is set (a load's budget, say).
 */
export function manualClock() {
  let now = 0
  const timers = new Set<{ at: number; ms: number; fire: () => void }>()
  const waiting: Array<{ ms: number; resolve: () => void }> = []
  return {
    now: () => now,
    setTimer(fire: () => void, ms: number) {
      const timer = { at: now + ms, ms, fire }
      timers.add(timer)
      for (const one of waiting.filter((wait) => wait.ms === ms)) {
        waiting.splice(waiting.indexOf(one), 1)
        one.resolve()
      }
      return () => void timers.delete(timer)
    },
    advance(ms: number) {
      now += ms
      for (const timer of Array.from(timers))
        if (timer.at <= now && timers.delete(timer)) timer.fire()
    },
    armed: (ms: number) =>
      [...timers].some((timer) => timer.ms === ms)
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiting.push({ ms, resolve })),
  }
}

export async function hostWithVms(
  mods: Record<string, string>,
  options: ModsHostOptions & { vms: ModVmPort },
  /** Runs while the first reconcile is still loading (a test that drives the clock meanwhile). */
  whileLoading?: () => Promise<void>,
) {
  const dir = scratch()
  const reports: string[] = []
  const logged: string[] = []
  const printed: string[] = []
  const waiters: Array<{ match: string; resolve: (line: string) => void }> = []
  const report = (plugin: string, message: string) => {
    const line = `${plugin}: ${message}`
    reports.push(line)
    for (const waiter of waiters.filter((one) => line.includes(one.match))) {
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(line)
    }
  }
  const host = createModsHost(
    {
      ...INERT_MOD_PORTS,
      dataDir: (plugin) => join(dir, 'data', plugin),
      workspaceDir: dir,
      report,
      log: (_scene, line) => void logged.push(line.text),
    },
    { print: (level, line) => void printed.push(`${level} ${line}`), ...options },
  )
  const sources: ModSource[] = Object.entries(mods).map(([plugin, code]) => {
    const root = join(dir, plugin)
    writeTree(root, { 'hooks/register.js': code })
    return { plugin, root, module: join(root, 'hooks/register.js'), options: {}, revision: '1' }
  })
  await Promise.all([host.reconcile(sources), whileLoading?.()])
  const scene: ModScene = { userId: 'u', sessionId: 's1', cwd: dir }
  return {
    host,
    dir,
    scene,
    reports,
    logged,
    printed,
    /** A command of `plugin`'s, as a person typing it would run it. */
    command: (plugin: string, command: string) =>
      host.runCommand({ command }, scene, new Set([plugin])) as Promise<{ text?: string }>,
    /** The first report, from now on, that contains `match`. */
    reported: (match: string) => new Promise<string>((resolve) => waiters.push({ match, resolve })),
  }
}
