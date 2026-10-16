import { describe, expect, test } from 'bun:test'
import { createBashTool } from './bash'
import type { SpawnTerminalJob } from '../terminal/terminal-job'

/** A PTY job that prints one line, stays up, and exits 130 when killed — as a closed pane does. */
function fakeServerHost() {
  const kills: (string | undefined)[] = []
  const spawn: SpawnTerminalJob = async () => {
    let exit: (code: number) => void = () => {}
    return {
      terminalId: 'pty-1',
      onData: (listener) => listener('Serving HTTP on 127.0.0.1 port 4173\n'),
      onExit: (listener) => {
        exit = listener
      },
      write: () => {},
      kill: (reason) => {
        kills.push(reason)
        queueMicrotask(() => exit(130))
      },
    }
  }
  return { spawn, kills }
}

function fakeRegistry() {
  const emits: { done?: boolean; jobStatus?: string; stop?: unknown }[] = []
  const actions = new Map<string, { kill: { execute: (payload?: unknown) => void } }>()
  return {
    emits,
    actions,
    context: {
      asyncRegistry: {
        emitBackground: (_id: string, _output: string, opts?: (typeof emits)[number]) => {
          if (opts) emits.push(opts)
        },
        registerActions: (id: string, a: never) => {
          actions.set(id, a)
          return () => actions.delete(id)
        },
      },
    } as never,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('a background job outlives its call', () => {
  // LOCALIX-388: `python3 -m http.server` with `timeout: 60` was closed after 60 s.
  test('ignores `timeout` — a server is not stopped when the call budget runs out', async () => {
    const host = fakeServerHost()
    const reg = fakeRegistry()
    const tool = createBashTool(undefined, undefined, { spawnTerminalJob: host.spawn })
    await tool.execute(
      'bg-timeout',
      { command: 'python3 -m http.server 4173', background: true, timeout: 60 },
      undefined,
      undefined,
      reg.context,
    )
    expect(host.kills).toEqual([])
    // The kill action still stops it, tagged with who asked.
    reg.actions.get('bg-timeout')!.kill.execute({ by: 'agent' })
    await settle()
    expect(host.kills).toEqual(['stopped by the agent'])
    expect(reg.emits.at(-1)).toMatchObject({
      done: true,
      jobStatus: 'killed',
      stop: { by: 'agent' },
    })
  }, 10_000)

  test('stopping the run after the call returned does not kill the job it started', async () => {
    const host = fakeServerHost()
    const reg = fakeRegistry()
    const run = new AbortController()
    const tool = createBashTool(undefined, undefined, { spawnTerminalJob: host.spawn })
    await tool.execute(
      'bg-run',
      { command: 'python3 -m http.server 4173', background: true },
      run.signal,
      undefined,
      reg.context,
    )
    run.abort()
    await settle()
    expect(host.kills).toEqual([])
    expect(reg.emits.some((e) => e.done)).toBe(false)
  }, 10_000)

  test("the person's Stop button reads as stopped by the person", async () => {
    const host = fakeServerHost()
    const reg = fakeRegistry()
    const tool = createBashTool(undefined, undefined, { spawnTerminalJob: host.spawn })
    await tool.execute(
      'bg-person',
      { command: 'npm run dev', background: true },
      undefined,
      undefined,
      reg.context,
    )
    reg.actions.get('bg-person')!.kill.execute()
    await settle()
    expect(host.kills).toEqual(['stopped by the person'])
    expect(reg.emits.at(-1)).toMatchObject({ jobStatus: 'killed', stop: { by: 'person' } })
  }, 10_000)
})
