import { describe, expect, test } from 'bun:test'
import { createBashTool } from './bash'
import type { SpawnTerminalJob, TerminalJobHandle } from '../terminal/terminal-job'
import { FAST_SETTLE } from './test-settle'

function fakeTerminalHost(url: string): { spawn: SpawnTerminalJob; commands: string[] } {
  const commands: string[] = []
  const spawn: SpawnTerminalJob = async ({ command }) => {
    commands.push(command)
    const handle: TerminalJobHandle = {
      terminalId: 'pty-1',
      onData: () => {},
      onExit: () => {},
      // The host detects the banner and hands the bash tool the URL it found.
      onPreviewUrl: (listener) => listener(url),
      write: () => {},
      kill: () => {},
    }
    return handle
  }
  return { spawn, commands }
}

describe('background bash on a terminal host', () => {
  test('tells the host a notify job wakes the agent, so its exit is reported once', async () => {
    // The host announced every PTY exit, and a `notify` job's woken turn announced it again.
    const asked: (boolean | undefined)[] = []
    const host = fakeTerminalHost('http://localhost:5174')
    const tool = createBashTool(undefined, undefined, {
      backgroundSettle: FAST_SETTLE,
      spawnTerminalJob: (input) => {
        asked.push(input.wakesAgent)
        return host.spawn(input)
      },
    })

    await tool.execute(
      'bg-notify',
      { command: 'npm test', background: true, notify: true },
      undefined,
    )
    await tool.execute(
      'bg-quiet',
      { command: 'npm run dev', background: true, cwd: '/work/project/frontend' },
      undefined,
    )

    expect(asked).toEqual([true, undefined])
  }, 10_000)
})
