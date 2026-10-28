import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'

import {
  installOrphanGuard,
  reapTrackedProcesses,
  trackSpawnedProcess,
  trackedProcessCount,
} from './orphan-guard'
import { isAlive } from './process-tree'

const waitUntilGone = async (pid: number): Promise<boolean> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await Bun.sleep(10)
  }
  return !isAlive(pid)
}

describe('the fatal-exit reaper', () => {
  test('tracks a live process and forgets it on request', () => {
    const before = trackedProcessCount()
    const untrack = trackSpawnedProcess(process.pid)
    expect(trackedProcessCount()).toBe(before + 1)
    untrack()
    expect(trackedProcessCount()).toBe(before)
  })

  test('a missing pid tracks nothing and disposes harmlessly', () => {
    const before = trackedProcessCount()
    trackSpawnedProcess(undefined)()
    trackSpawnedProcess(0)()
    trackSpawnedProcess(-1)()
    expect(trackedProcessCount()).toBe(before)
  })

  test.skipIf(process.platform === 'win32')(
    "reaps a detached GROUP, so the shell's own children die with it",
    async () => {
      // The shape a background job actually has: detached into its own process group
      // (which is why a signal to the server never reaches it) with a child of its own
      // (a dev server, a build daemon). Killing the leader alone would leave the
      // grandchild running, so the group form is the whole point.
      const child = spawn('bash', ['-c', 'sleep 30 & echo $!; wait'], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const grandchildPid = await new Promise<number>((resolve) => {
        child.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())))
      })
      expect(isAlive(child.pid!)).toBe(true)
      expect(isAlive(grandchildPid)).toBe(true)

      trackSpawnedProcess(child.pid)
      reapTrackedProcesses()

      expect(await waitUntilGone(child.pid!)).toBe(true)
      expect(await waitUntilGone(grandchildPid)).toBe(true)
      // Reaping empties the registry: nothing is left to kill twice.
      expect(trackedProcessCount()).toBe(0)
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a dead pid is contained — the rest are still reaped',
    async () => {
      const dead = spawn('bash', ['-c', 'exit 0'], { detached: true, stdio: 'ignore' })
      await new Promise((resolve) => dead.once('exit', resolve))
      const live = spawn('bash', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' })

      trackSpawnedProcess(dead.pid)
      trackSpawnedProcess(live.pid)
      // One target that cannot be signalled must not stop the others: a fatal-exit handler
      // gets one pass and no retry.
      reapTrackedProcesses()

      expect(await waitUntilGone(live.pid!)).toBe(true)
    },
  )

  test('installing twice adds one handler, and its disposer is the same', () => {
    const before = process.listenerCount('exit')
    const first = installOrphanGuard()
    const second = installOrphanGuard()
    expect(second).toBe(first)
    expect(process.listenerCount('exit')).toBe(before + 1)
    first()
    expect(process.listenerCount('exit')).toBe(before)
  })

  test('after its disposer runs, a fresh install works again', () => {
    const before = process.listenerCount('exit')
    installOrphanGuard()()
    const again = installOrphanGuard()
    expect(process.listenerCount('exit')).toBe(before + 1)
    again()
    expect(process.listenerCount('exit')).toBe(before)
  })
})
