import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { answersVersion } from './lsp-bin-resolve'
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

describe('answersVersion', () => {
  /** An executable script at `dir/name` that runs `body`. */
  const script = (at: string, name: string, body: string) => {
    const file = path.join(at, name)
    writeFileSync(file, `#!/bin/sh\n${body}\n`)
    chmodSync(file, 0o755)
    return file
  }

  test("a binary that prints its version answers; rustup's proxy without the component does not", async () => {
    const cwd = dir()
    const server = script(cwd, 'rust-analyzer', 'echo "rust-analyzer 1.96.1"')
    const shim = script(
      cwd,
      'rustup-proxy',
      `echo "error: Unknown binary 'rust-analyzer' in official toolchain" >&2; exit 1`,
    )

    expect(await answersVersion(server, cwd)).toBe(true)
    expect(await answersVersion(shim, cwd)).toBe(false)
    expect(await answersVersion(path.join(cwd, 'absent'), cwd)).toBe(false)
  })

  test('it runs from the crate it is asked about, where a rust-toolchain.toml picks the toolchain', async () => {
    const at = dir()
    const pinned = path.join(at, 'pinned')
    mkdirSync(pinned)
    writeFileSync(path.join(pinned, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.96.1"\n')
    // Like the proxy: fine on the default toolchain, no component on the pinned one.
    const proxy = script(at, 'rust-analyzer', '[ -f rust-toolchain.toml ] && exit 1; echo ok')

    expect(await answersVersion(proxy, at)).toBe(true)
    expect(await answersVersion(proxy, pinned)).toBe(false)
  })
})
