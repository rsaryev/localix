import { describe, expect, test } from 'bun:test'
import { createBashTool } from '../bash/bash'
import { runTerminalAction, type TerminalToolDeps } from './terminal'
import type { ScreenSnapshot } from './terminal-job'
import { watchTerminalActivity } from './terminal-activity'

function terminal(initial = 'PROMPT>') {
  let live = true
  let text = initial
  let final: ScreenSnapshot | null = null
  let fire: (event: 'output' | 'exit') => void = () => {}
  const writes: string[] = []
  const snapshot = (): ScreenSnapshot => ({
    text,
    cols: 80,
    rows: 24,
    cursor: { row: 0, col: 0 },
  })
  const deps: TerminalToolDeps = {
    open: async () => ({ terminalId: 't1', screen: snapshot() }),
    screen: async () => (live ? snapshot() : null),
    finalScreen: async () => final,
    watch: (_id, listener) => {
      if (!live) return null
      fire = listener
      return () => {
        fire = () => {}
      }
    },
    write: (_id, data) => {
      writes.push(data)
      return live
    },
    list: () => (live ? [{ terminalId: 't1' }] : []),
    close: () => {
      live = false
      return true
    },
  }
  return {
    deps,
    writes,
    emit: (next: string) => {
      text = next
      fire('output')
    },
    exit: (next: string) => {
      text = next
      final = snapshot()
      live = false
      fire('exit')
    },
  }
}

describe('interactive input and observation in one bash call', () => {
  test('types, submits a real Enter, and awaits the resulting screen', async () => {
    const { deps, writes, emit } = terminal()
    const lifecycle: unknown[] = []
    deps.onWait = (event) => lifecycle.push(event)
    deps.write = (_id, data) => {
      writes.push(data)
      if (data === '\r') setTimeout(() => emit('Model picker ready'), 0)
      return true
    }
    const tool = createBashTool(undefined, undefined, { terminalControl: deps })
    const result = await tool.execute(
      'call',
      {
        action: 'type',
        terminal_id: 't1',
        text: '/model',
        keys: ['Enter'],
        wait_for: 'Model picker ready',
        wait_timeout_ms: 500,
      },
      undefined,
      undefined,
      undefined,
    )
    expect(writes).toEqual(['/model', '\r'])
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Model picker ready')
    expect(result.details).toMatchObject({
      action: 'type',
      state: 'running',
      waitOutcome: 'matched',
    })
    expect(result.supersedeKey).toBe('terminal:t1')
    expect(result.details).toMatchObject({ screenChanged: true })
    expect(lifecycle).toEqual([
      { terminalId: 't1', active: true, label: 'until text appears' },
      { terminalId: 't1', active: false, label: 'until text appears' },
    ])
  })

  test('literal text and Enter in a key batch are separate input bursts too', async () => {
    const { deps, writes } = terminal('done')
    const result = await runTerminalAction(deps, {
      action: 'keys',
      terminal_id: 't1',
      keys: ['/model', 'Enter'],
      wait_for: 'done',
    })
    expect(writes).toEqual(['/model', '\r'])
    expect(result.content).not.toContain('/model')
    expect(result.content).toContain('Sent text Enter')
    expect(result.content).toContain('Display unchanged; input effect is unconfirmed')
    expect(result.details?.screenChanged).toBe(false)
  })

  test('type results never echo literal trailing key payloads', async () => {
    const { deps } = terminal('done')
    const result = await runTerminalAction(deps, {
      action: 'type',
      terminal_id: 't1',
      text: 'secret-one',
      keys: ['secret-two'],
      wait_for: 'done',
    })
    expect(result.content).toContain('Sent text + text')
    expect(result.content).not.toContain('secret-one')
    expect(result.content).not.toContain('secret-two')
  })

  test('open can await a prompt in the same call', async () => {
    const { deps, emit } = terminal('starting')
    setTimeout(() => emit('READY>'), 0)
    const result = await runTerminalAction(deps, {
      action: 'open',
      command: 'repl',
      wait_for: 'READY>',
      wait_timeout_ms: 500,
    })
    expect(result.details).toMatchObject({
      action: 'open',
      command: 'repl',
      waitOutcome: 'matched',
    })
  })

  test('a process exiting immediately after Enter still returns its final answer', async () => {
    const { deps, exit } = terminal()
    deps.write = (_id, data) => {
      if (data === '\r') exit('DONE')
      return true
    }
    const result = await runTerminalAction(deps, {
      action: 'type',
      terminal_id: 't1',
      text: 'hello',
      keys: ['Enter'],
      wait_for: 'DONE',
    })
    expect(result.isError).toBeFalsy()
    expect(result.details).toMatchObject({ state: 'exited', waitOutcome: 'matched' })
    expect(result.content).toContain('DONE')
    expect(result.content).toContain('t1: exited')
  })

  test('screen reads retain final output and explicitly say the process exited', async () => {
    const { deps, exit } = terminal()
    exit('final answer')
    const result = await runTerminalAction(deps, { action: 'screen', terminal_id: 't1' })
    expect(result.isError).toBeFalsy()
    expect(result.details?.state).toBe('exited')
    expect(result.content).toContain('final answer')
  })

  test('invalid waits are rejected before sending text', async () => {
    const { deps, writes } = terminal()
    const result = await runTerminalAction(deps, {
      action: 'type',
      terminal_id: 't1',
      text: 'delete',
      wait_absent: true,
    })
    expect(result.isError).toBe(true)
    expect(writes).toEqual([])
  })

  test('an aborted action never sends input', async () => {
    const { deps, writes } = terminal()
    const result = await runTerminalAction(
      deps,
      {
        action: 'type',
        terminal_id: 't1',
        text: 'hello',
        keys: ['Enter'],
      },
      AbortSignal.abort(),
    )
    expect(result.content).toContain('INTERRUPTED')
    expect(writes).toEqual([])
  })

  test('abort during the text/key gap suppresses Enter and subsequent keys', async () => {
    const { deps, writes } = terminal()
    const controller = new AbortController()
    deps.write = (_id, data) => {
      writes.push(data)
      queueMicrotask(() => controller.abort())
      return true
    }
    const result = await runTerminalAction(
      deps,
      {
        action: 'type',
        terminal_id: 't1',
        text: 'hello',
        keys: ['Enter', 'Escape'],
      },
      controller.signal,
    )
    expect(result.content).toContain('INTERRUPTED')
    expect(writes).toEqual(['hello'])
  })

  test('a rejected trailing Enter is reported and later keys are not sent', async () => {
    const { deps, writes } = terminal()
    deps.write = (_id, data) => {
      writes.push(data)
      return data !== '\r'
    }
    const result = await runTerminalAction(deps, {
      action: 'type',
      terminal_id: 't1',
      text: 'hello',
      keys: ['Enter', 'Escape'],
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('remaining input was not sent')
    expect(writes).toEqual(['hello', '\r'])
  })

  test('arrow key batches use application mode and return the resulting screen', async () => {
    const { deps, writes } = terminal()
    deps.screen = async () => ({
      text: 'menu',
      cols: 80,
      rows: 24,
      cursor: { row: 1, col: 0 },
      applicationCursorKeys: true,
    })
    await runTerminalAction(deps, {
      action: 'keys',
      terminal_id: 't1',
      keys: ['Down', 'Enter'],
      wait_for: 'menu',
    })
    expect(writes).toEqual(['\x1bOB', '\r'])
  })

  test('unchanged text with ongoing output does not certify quiet', async () => {
    const { deps } = terminal('working')
    deps.watch = (_id, listener) => {
      const timer = setInterval(() => listener('output'), 10)
      return () => clearInterval(timer)
    }
    const result = await runTerminalAction(deps, {
      action: 'wait',
      terminal_id: 't1',
      wait_timeout_ms: 150,
    })
    expect(result.details?.waitOutcome).toBe('timeout')
  })

  test('queued output cannot overrun an already reached deadline', async () => {
    const activity = watchTerminalActivity((_id, listener) => {
      listener('output')
      return () => {}
    }, 't1')
    try {
      expect(await activity.next(Date.now())).toBe('deadline')
    } finally {
      activity.close()
    }
  })
})
