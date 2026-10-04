import { afterEach, describe, expect, test } from 'bun:test'

import { resolveShellConfig, resetShellConfigCache } from '../agent-core/tools/environments/shell'
import { disposePty, ptyArgv, ptyTreeStillOurs } from './pty-bun'

afterEach(() => resetShellConfigCache())

describe('PTY argv', () => {
  // A one-shot pane runs the agent's `bash background:true` text. `powershell -Command`
  // mistranslated its POSIX syntax, so the same command behaved differently depending
  // only on whether a terminal host was wired.
  test('a one-shot command on Windows runs through the resolved agent shell', () => {
    const agent = resolveShellConfig()
    const argv = ptyArgv({ command: 'npm run dev && echo "$PORT"' }, 'win32')
    expect(argv).toEqual([agent.shell, ...agent.args, 'npm run dev && echo "$PORT"'])
    expect(argv).not.toContain('-Command')
  })

  test('a one-shot command elsewhere keeps the login shell', () => {
    expect(ptyArgv({ shell: '/bin/zsh', command: 'make' }, 'darwin')).toEqual([
      '/bin/zsh',
      '-lc',
      'make',
    ])
  })

  test('an interactive pane keeps the user shell and its injected args', () => {
    expect(ptyArgv({ shell: 'pwsh.exe', shellArgs: ['-NoLogo'] }, 'win32')).toEqual([
      'pwsh.exe',
      '-NoLogo',
    ])
  })
})

describe('PTY teardown', () => {
  // Closing first blocked the event loop on Windows before 11 24H2: ClosePseudoConsole
  // waits for every console client to exit.
  test('kills the process tree before closing the pseudo-console', () => {
    const order: string[] = []
    disposePty({ terminal: { close: () => order.push('close') } }, () => order.push('kill'))
    expect(order).toEqual(['kill', 'close'])
  })

  test('a terminal that is already closed does not stop the kill', () => {
    const order: string[] = []
    const throwing = {
      close: () => {
        throw new Error('closed')
      },
    }
    expect(() => disposePty({ terminal: throwing }, () => order.push('kill'))).not.toThrow()
    expect(order).toEqual(['kill'])
  })
})

describe('ptyTreeStillOurs — the escalation guard handed to the shared tree kill', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  test('still ours while the shell runs', () => {
    expect(ptyTreeStillOurs({ pid: 1, exited: new Promise(() => {}) }, () => true)()).toBe(true)
  })

  test('a shell that exited with a grandchild left in its group still escalates', async () => {
    const ours = ptyTreeStillOurs({ pid: 1, exited: Promise.resolve(0) }, () => true)
    await tick()
    expect(ours()).toBe(true)
  })

  test('a group gone at exit cancels the SIGKILL — its number may be recycled', async () => {
    const ours = ptyTreeStillOurs({ pid: 1, exited: Promise.resolve(0) }, () => false)
    await tick()
    expect(ours()).toBe(false)
  })
})
