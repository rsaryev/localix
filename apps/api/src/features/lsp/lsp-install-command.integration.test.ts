import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { runCommand } from './lsp-install-command'

const dir = tempDirPerTest('localix-lsp-command')

const turn = () => new Promise<void>((resolve) => setImmediate(resolve))
async function until(done: () => boolean, what: string) {
  const deadline = Date.now() + 5_000
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`)
    await turn()
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('runCommand', () => {
  test('a timeout kills the whole tree, not only the direct child, and says it timed out', async () => {
    const cwd = dir()
    const pidFile = path.join(cwd, 'grandchild.pid')
    let fire = () => {}
    const run = runCommand(
      {
        command: '/bin/sh',
        args: ['-c', `sleep 30 & echo $! > grandchild.pid; wait`],
        cwd,
      },
      { setTimer: (fn) => ((fire = fn), () => {}) },
    )
    await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', 'child')
    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    try {
      expect(alive(grandchild)).toBe(true)
      fire()
      expect(await run).toMatchObject({ timedOut: true })
      await until(() => !alive(grandchild), 'the grandchild to die')
    } finally {
      try {
        process.kill(grandchild, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  })
})
