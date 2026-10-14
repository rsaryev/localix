import { describe, expect, test } from 'bun:test'

import { isAlive, killProcessTree } from '../bash/process-tree'
import { spawnToResult } from './spawn'

const waitUntilGone = async (pid: number): Promise<boolean> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await Bun.sleep(10)
  }
  return !isAlive(pid)
}

describe('spawnToResult process-tree teardown', () => {
  test.skipIf(process.platform === 'win32')(
    'abort reaps a descendant in the spawned process group',
    async () => {
      const abort = new AbortController()
      const run = spawnToResult(
        'bash',
        ['-c', 'sleep 30 & child=$!; echo "$child"; wait "$child"'],
        { signal: abort.signal },
      )

      await Bun.sleep(30)
      abort.abort()
      const result = await run
      const childPid = Number(result.stdout.trim().split(/\s+/)[0])

      expect(result.exitCode).toBe(130)
      expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true)
      expect(await waitUntilGone(childPid)).toBe(true)
    },
  )
})

describe('spawnToResult timeout policy', () => {
  test.skipIf(process.platform === 'win32')(
    'the default deadline still kills and reports 124',
    async () => {
      const result = await spawnToResult('bash', ['-c', 'echo early; sleep 30'], { timeout: 0.2 })

      expect(result.exitCode).toBe(124)
      expect(result.detached).toBeUndefined()
      expect(result.stdout).toContain('early')
      expect(result.stderr).toContain('Timed out after 0.2s')
    },
  )

  test.skipIf(process.platform === 'win32')(
    'onTimeout detach hands back a live child with what it printed so far',
    async () => {
      const result = await spawnToResult('bash', ['-c', 'echo early; sleep 30'], {
        timeout: 0.2,
        onTimeout: 'detach',
      })

      expect(result.detached).toBeDefined()
      // No verdict: the process has not exited, so no exit code can be honest.
      expect(result.exitCode).toBe(-1)
      expect(result.stderr).not.toContain('Timed out')
      expect(result.detached!.stdout).toContain('early')

      const pid = result.detached!.child.pid!
      expect(isAlive(pid)).toBe(true)

      // Ownership transferred: nothing reaps this but the caller.
      killProcessTree(pid, 0)
      expect(await waitUntilGone(pid)).toBe(true)
    },
  )

  test.skipIf(process.platform === 'win32')(
    'output produced after the handover is buffered, not lost',
    async () => {
      const result = await spawnToResult(
        'bash',
        ['-c', 'echo before; sleep 0.4; echo after; sleep 30'],
        { timeout: 0.2, onTimeout: 'detach' },
      )
      const detached = result.detached!
      expect(detached.stdout).toContain('before')
      expect(detached.stdout).not.toContain('after')

      // The streams were PAUSED at handover, so a late write queues in the stream
      // rather than vanishing between our listener and the adopter's.
      let late = ''
      detached.child.stdout?.on('data', (chunk: Buffer) => {
        late += chunk.toString()
      })
      detached.child.stdout?.resume()
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && !late.includes('after')) await Bun.sleep(10)

      expect(late).toContain('after')
      killProcessTree(detached.child.pid!, 0)
      expect(await waitUntilGone(detached.child.pid!)).toBe(true)
    },
  )
})
