/**
 * The shared tree kill, against real process groups.
 *
 * Each case spawns a detached `sh` (its own group) that starts a grandchild and prints its pid,
 * so the assertion is about the GRANDCHILD — the process a leader-only kill would orphan. Every
 * spawn carries a `timeout` + SIGKILL, and `afterEach` reaps whatever a failed case left.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { isAlive, killProcessTree, killProcessTreeNow } from './process-tree'

const posix = process.platform !== 'win32'
const leaders: number[] = []

afterEach(() => {
  for (const pid of leaders.splice(0)) killProcessTreeNow(pid)
})

/** A detached shell leading its own group, plus the pid of the `sleep` it started. */
async function spawnTree(script: string): Promise<{ leader: number; grandchild: number }> {
  const child = spawn('sh', ['-c', `${script} sleep 30 & echo $!; wait`], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    killSignal: 'SIGKILL',
  })
  child.unref()
  if (!child.pid) throw new Error('spawn failed')
  leaders.push(child.pid)
  const grandchild = await new Promise<number>((resolve, reject) => {
    child.stdout?.once('data', (b: Buffer) => resolve(Number.parseInt(b.toString(), 10)))
    child.once('error', reject)
  })
  return { leader: child.pid, grandchild }
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return !isAlive(pid)
}

describe.skipIf(!posix)('killProcessTree (real processes)', () => {
  test('SIGTERM reaches the grandchild through the group, not just the leader', async () => {
    const { leader, grandchild } = await spawnTree('')
    killProcessTree(leader, 5_000)
    expect(await goneWithin(grandchild, 2_000)).toBe(true)
    expect(await goneWithin(leader, 2_000)).toBe(true)
  })

  test('a tree that ignores SIGTERM is SIGKILLed after the grace, not before', async () => {
    const { leader, grandchild } = await spawnTree(`trap '' TERM;`)
    killProcessTree(leader, 300)
    await new Promise((r) => setTimeout(r, 100))
    expect(isAlive(grandchild)).toBe(true) // still inside the grace
    expect(await goneWithin(grandchild, 2_000)).toBe(true)
  })

  test('an escalation the caller says is no longer ours is never sent', async () => {
    const { leader, grandchild } = await spawnTree(`trap '' TERM;`)
    killProcessTree(leader, 50, () => false)
    await new Promise((r) => setTimeout(r, 250))
    expect(isAlive(grandchild)).toBe(true)
  })
})

describe.skipIf(!posix)('killProcessTreeNow (real processes)', () => {
  test('SIGKILLs the whole group at once, signal handlers or not', async () => {
    const { leader, grandchild } = await spawnTree(`trap '' TERM;`)
    killProcessTreeNow(leader)
    expect(await goneWithin(grandchild, 2_000)).toBe(true)
  })

  test('an invalid pid is a no-op rather than a signal to our own group', () => {
    expect(() => killProcessTreeNow(0)).not.toThrow()
    expect(() => killProcessTreeNow(undefined)).not.toThrow()
    expect(() => killProcessTreeNow(-1)).not.toThrow()
  })
})
