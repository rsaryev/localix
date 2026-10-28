import { describe, expect, test } from 'bun:test'
import { isAlive } from '../../lib/process-tree'
import { runHookCommand } from './command'

// A killed process stays visible to `kill(pid, 0)` as a zombie until its new parent reaps it, which
// under load can come after `runHookCommand` has resolved. The guarantee is that the kill was sent
// to the whole group, so the grandchild goes away shortly after, not that it is reaped by then.
async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return !isAlive(pid)
}

describe.skipIf(process.platform === 'win32')('hook command process tree (real processes)', () => {
  test('a timeout kills what the shell started, not only the shell', async () => {
    const result = await runHookCommand({
      command: 'sleep 30 & echo $!; wait',
      cwd: process.cwd(),
      input: '',
      env: {},
      timeoutMs: 200,
      maxOutputBytes: 1024,
    })
    expect(result.timedOut).toBe(true)
    const pid = Number(result.stdout.trim())
    expect(pid).toBeGreaterThan(0)
    expect(await goneWithin(pid, 5_000)).toBe(true)
  })
})
