import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { run, tempDirPerTest, writeTree } from '@localixai/testing'
import { createBashTool } from './bash'
import type { SpawnTerminalJob, TerminalJobHandle } from '../terminal/terminal-job'

const root = tempDirPerTest('bash-plugin-bin-')

/**
 * A terminal host whose pane runs the command the way a login shell does: with the person's PATH,
 * which names no plugin. Its output and exit reach the job like a real pane's.
 */
function loginShellTerminalHost(): SpawnTerminalJob {
  return async ({ command, cwd }) => {
    const done = run('/bin/sh', ['-c', command], {
      cwd,
      env: { PATH: '/usr/bin:/bin', HOME: cwd },
      timeoutMs: 10_000,
    })
    const handle: TerminalJobHandle = {
      terminalId: 'pty-1',
      onData: (listener) => {
        void done.then((result) => listener(result.stdout + result.stderr))
      },
      onExit: (listener) => {
        void done.then((result) => listener(result.code ?? 1))
      },
      write: () => {},
      kill: () => {},
    }
    return handle
  }
}

function pluginWithCli(): string {
  const plugin = join(root(), 'sample-plugin')
  writeTree(plugin, { 'bin/mini-app': '#!/bin/sh\necho "mini-app $1 ran"\n' })
  chmodSync(join(plugin, 'bin/mini-app'), 0o755)
  return join(plugin, 'bin')
}

describe('a background command in a terminal pane', () => {
  test("finds an enabled plugin's command by its bare name, as a foreground command does", async () => {
    // `mini-app check` sent to the background in Localix's desktop app answered
    // `command not found: mini-app`: the pane's login shell never got the plugins' bin folders.
    const tool = createBashTool(undefined, undefined, {
      backgroundSettle: { minMs: 0, maxMs: 2_000, quietMs: 200 },
      spawnTerminalJob: loginShellTerminalHost(),
      pluginBinDirs: [pluginWithCli()],
    })

    const result = await tool.execute(
      'bg-check',
      { command: 'mini-app check', background: true, cwd: root() },
      undefined,
    )

    expect(result.content).toContain('mini-app check ran')
    expect(result.content).not.toContain('not found')
  }, 15_000)
})
