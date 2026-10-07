import { describe, expect, test } from 'bun:test'
import { createBashTool } from '../bash/bash'
import { runTerminalAction, waitForScreen, type TerminalToolDeps } from './terminal'
import { compactScreenText, SCREEN_OBSERVATION_CHARS } from './terminal-observation'
import type { ScreenSnapshot } from './terminal-job'

function terminal(initial = 'READY>') {
  let text = initial
  let live = true
  let listener: (event: 'output' | 'exit') => void = () => {}
  const writes: string[] = []
  const state = { renders: 0, subscriptions: 0 }
  const snapshot = (): ScreenSnapshot => ({
    text,
    cols: 80,
    rows: 24,
    cursor: { row: 0, col: 0 },
  })
  const deps: TerminalToolDeps = {
    open: async () => ({ terminalId: 't1', screen: snapshot() }),
    screen: async () => {
      state.renders++
      return live ? snapshot() : null
    },
    finalScreen: async () => (live ? null : snapshot()),
    watch: (_id, onEvent) => {
      if (!live) return null
      state.subscriptions++
      listener = onEvent
      return () => {
        state.subscriptions--
        listener = () => {}
      }
    },
    write: (_id, data) => {
      writes.push(data)
      return live
    },
    list: () => [],
    close: () => false,
  }
  return {
    deps,
    writes,
    state,
    exit(final = 'DONE') {
      text = final
      live = false
      listener('exit')
    },
  }
}

describe('terminal round-trip efficiency', () => {
  test('input can await exit and return the final screen in one bash call', async () => {
    const { deps, writes, state, exit } = terminal()
    const lifecycle: unknown[] = []
    deps.onWait = (event) => lifecycle.push(event)
    deps.write = (_id, data) => {
      writes.push(data)
      if (data === '\r') setTimeout(() => exit(), 120)
      return true
    }
    const tool = createBashTool(undefined, undefined, { terminalControl: deps })
    const result = await tool.execute('call', {
      action: 'type',
      terminal_id: 't1',
      text: 'exit',
      keys: ['Enter'],
      wait_for_exit: true,
      wait_timeout_ms: 500,
    })
    expect(writes).toEqual(['exit', '\r'])
    expect(result.details).toMatchObject({ state: 'exited', waitOutcome: 'exited' })
    expect(result.content).toContain('DONE')
    expect(result.supersedeKey).toBe('terminal:t1')
    expect(state.subscriptions).toBe(0)
    expect(lifecycle).toEqual([
      { terminalId: 't1', active: true, label: 'until process exits' },
      { terminalId: 't1', active: false, label: 'until process exits' },
    ])
  })

  test('a silent live process times out rather than resolving as quiet', async () => {
    const { deps, state } = terminal()
    const result = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for_exit: true,
      wait_timeout_ms: 120,
    })
    expect(result.details).toMatchObject({ state: 'running', waitOutcome: 'timeout' })
    expect(result.content).toContain('the program is still running')
    expect(state.renders).toBe(1)
    expect(state.subscriptions).toBe(0)
  })

  test('a previously exited process returns its final screen immediately', async () => {
    const { deps, exit } = terminal()
    exit()
    const result = await waitForScreen(deps, { terminalId: 't1', wait_for_exit: true })
    expect(result.details).toMatchObject({ state: 'exited', waitOutcome: 'exited' })
    expect(result.content).toContain('DONE')
  })

  test('cancelling an exit wait unsubscribes and preserves live state', async () => {
    const { deps, state } = terminal()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)
    const result = await waitForScreen(
      deps,
      { terminalId: 't1', wait_for_exit: true },
      controller.signal,
    )
    expect(result.details).toMatchObject({ state: 'running', waitOutcome: 'interrupted' })
    expect(state.subscriptions).toBe(0)
  })

  test('conflicting exit/text waits are rejected before opening or writing', async () => {
    const { deps, writes } = terminal()
    let opens = 0
    deps.open = async () => {
      opens++
      return { terminalId: 't1', screen: null }
    }
    for (const action of ['open', 'type'] as const) {
      const result = await runTerminalAction(deps, {
        action,
        command: 'repl',
        terminal_id: 't1',
        text: 'exit',
        wait_for_exit: true,
        wait_for: 'DONE',
      })
      expect(result.isError).toBe(true)
    }
    expect(opens).toBe(0)
    expect(writes).toEqual([])
    expect(
      (await waitForScreen(deps, { terminalId: 't1', wait_for_exit: true, wait_absent: true }))
        .isError,
    ).toBe(true)
  })

  test('an old marker does not certify a new response even when input changes the screen', async () => {
    const { deps } = terminal('DONE\nPROMPT>')
    let reads = 0
    deps.screen = async () => ({
      text: reads++ === 0 ? 'DONE\nPROMPT>' : 'DONE\nPROMPT>new request',
      cols: 80,
      rows: 24,
      cursor: { row: 1, col: 0 },
    })
    const result = await runTerminalAction(deps, {
      action: 'type',
      terminal_id: 't1',
      text: 'new request',
      wait_for: 'DONE',
    })
    expect(result.details).toMatchObject({ screenChanged: true, waitMatchPreexisting: true })
    expect(result.content).toContain('does not confirm a new response')
  })

  test('large automatic observations are bounded while details and screen retain the viewport', async () => {
    const text = 'HEADER\n' + 'output 🙂\n'.repeat(1_000) + 'DONE\nPROMPT>'
    const { deps } = terminal(text)
    const result = await runTerminalAction(deps, {
      action: 'wait',
      terminal_id: 't1',
      wait_for: 'DONE',
    })
    expect(result.content.length).toBeLessThan(SCREEN_OBSERVATION_CHARS + 400)
    expect(result.content).toContain('HEADER')
    expect(result.content).toContain('DONE\nPROMPT>')
    expect(result.content).toContain('viewport clipped')
    expect(result.details?.screen?.text).toBe(text)
    const full = await runTerminalAction(deps, { action: 'screen', terminal_id: 't1' })
    expect(full.content).toContain(text)
    expect(full.content).not.toContain('viewport clipped')
  })
})

describe('compact viewport evidence', () => {
  test('keeps small screens verbatim', () => {
    expect(compactScreenText('PROMPT>')).toBe('PROMPT>')
  })

  test('keeps a match in the omitted middle or crossing a clipping boundary', () => {
    for (const prefixLength of [490, 2_000, 3_490]) {
      const text =
        'a'.repeat(prefixLength) + 'UNIQUE_RESPONSE_MARKER' + 'z'.repeat(5_000 - prefixLength)
      const result = compactScreenText(text, 'UNIQUE_RESPONSE_MARKER')
      expect(result).toContain('UNIQUE_RESPONSE_MARKER')
      expect(result.length).toBeLessThan(SCREEN_OBSERVATION_CHARS + 200)
    }
  })

  test('does not introduce lone surrogates at clipped emoji boundaries', () => {
    const result = compactScreenText('a' + '🙂'.repeat(4_000))
    expect(Buffer.from(result).toString()).toBe(result)
  })
})
