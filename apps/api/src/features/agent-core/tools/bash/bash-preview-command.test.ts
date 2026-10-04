/**
 * A detected dev server must remember HOW it was started.
 *
 * Only the job that printed the banner knows the command — `npm run dev`, `node server.js`,
 * a compose stack, any of a thousand shapes. Without it the preview pane can offer nothing
 * but a dead reload once the server stops, which is exactly what it did: detection recorded
 * the URL alone. Detection itself stays the host's, from output content, never the command.
 */
import { describe, expect, test } from 'bun:test'
import { createBashTool } from './bash'
import type { SpawnTerminalJob, TerminalJobHandle } from '../terminal/terminal-job'

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

describe('background bash preview provenance', () => {
  test('records the launching command alongside the detected URL', async () => {
    const recorded: Array<[string, string | undefined]> = []
    const host = fakeTerminalHost('http://localhost:5174')
    const tool = createBashTool(undefined, undefined, {
      spawnTerminalJob: host.spawn,
      recordPreviewTarget: (url, startCommand) => recorded.push([url, startCommand]),
    })

    await tool.execute('bg-preview', { command: 'npm run dev', background: true }, undefined)

    expect(recorded).toEqual([['http://localhost:5174', 'npm run dev']])
  }, 10_000)

  test('tells the host a notify job wakes the agent, so its exit is reported once', async () => {
    // The host announced every PTY exit, and a `notify` job's woken turn announced it again.
    const asked: (boolean | undefined)[] = []
    const host = fakeTerminalHost('http://localhost:5174')
    const tool = createBashTool(undefined, undefined, {
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
    await tool.execute('bg-quiet', { command: 'npm run dev', background: true }, undefined)

    expect(asked).toEqual([true, undefined])
  }, 10_000)
})
