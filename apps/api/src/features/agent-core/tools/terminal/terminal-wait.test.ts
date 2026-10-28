/**
 * action="wait" — waiting on CONTENT instead of polling for it.
 *
 * The behaviour under test is mostly about what the model is TOLD. A wait that
 * times out still returns a screen, and the screen of a program that is merely
 * slow looks identical to the screen of one that is done — so if the verdict is
 * vague, the agent reads "still compiling" as "compiled" and moves on. Each test
 * here pins the verdict, not just the control flow.
 */
import { describe, expect, test } from 'bun:test'
import { runTerminalAction, waitForScreen, type TerminalToolDeps } from './terminal'
import type { ScreenSnapshot } from './terminal-job'

const snap = (text: string): ScreenSnapshot => ({
  text,
  cols: 80,
  rows: 24,
  cursor: { row: 0, col: 0 },
})

/**
 * A terminal whose screen walks through `frames`, one per render, then holds the last. It
 * talks continuously (an output event every 15ms) so each frame is reached by an output wake.
 */
function fakeTerminal(frames: (string | null)[]): TerminalToolDeps {
  let i = 0
  return {
    open: async () => ({ terminalId: 't1', screen: null }),
    screen: async () => {
      const frame = frames[Math.min(i, frames.length - 1)]
      i++
      return frame === null ? null : snap(frame)
    },
    watch: (_id, onEvent) => {
      const timer = setInterval(() => {
        if (i < frames.length) onEvent('output')
      }, 15)
      return () => clearInterval(timer)
    },
    write: () => true,
    list: () => [],
    close: () => true,
  }
}

/** A terminal whose events the test fires by hand, counting every render. */
function scriptedTerminal(initial: string) {
  let text: string | null = initial
  let fire: (event: 'output' | 'exit') => void = () => {}
  const state = { renders: 0 }
  const deps: TerminalToolDeps = {
    open: async () => ({ terminalId: 't1', screen: null }),
    screen: async () => {
      state.renders++
      return text === null ? null : snap(text)
    },
    watch: (_id, onEvent) => {
      fire = onEvent
      return () => {
        fire = () => {}
      }
    },
    write: () => true,
    list: () => [],
    close: () => true,
  }
  const emit = (next: string | null, event: 'output' | 'exit' = 'output') => {
    text = next
    fire(event)
  }
  return { deps, state, emit }
}

describe('action="wait" is driven by terminal events, not a render timer', () => {
  test('a silent terminal is rendered once, however long the wait', async () => {
    // The old loop re-rendered every 80ms: ~4 renders here, ~1500 over a 2-minute wait.
    const { deps, state } = scriptedTerminal('Compiling…')
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'Compiled',
      wait_timeout_ms: 300,
    })
    expect(res.content).toContain('TIMED OUT')
    expect(state.renders).toBe(1)
  })

  test('output wakes the wait, and one render answers it', async () => {
    const { deps, state, emit } = scriptedTerminal('Compiling…')
    setTimeout(() => emit('Compiled successfully'), 0)
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'Compiled',
      wait_timeout_ms: 5_000,
    })
    expect(res.content).toContain('appeared')
    expect(state.renders).toBe(2)
  })

  test('an exit wakes the wait and the archived final screen is checked', async () => {
    const { deps, emit } = scriptedTerminal('PROMPT>')
    deps.finalScreen = async () => snap('PROMPT>DONE')
    setTimeout(() => emit(null, 'exit'), 0)
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'DONE',
      wait_timeout_ms: 5_000,
    })
    expect(res.content).toContain('"DONE" appeared')
  })

  test('with no wait_for, a terminal that prints nothing is quiet after one render', async () => {
    const { deps, state } = scriptedTerminal('$ ')
    const res = await waitForScreen(deps, { terminalId: 't1', wait_timeout_ms: 5_000 })
    expect(res.content).toContain('went quiet')
    expect(state.renders).toBe(1)
  })

  test('the settle after keys re-renders on output, not on a timer', async () => {
    const { deps, state } = scriptedTerminal('$ ls')
    await runTerminalAction(deps, { action: 'keys', terminal_id: 't1', keys: ['Enter'] })
    expect(state.renders).toBe(2) // before input, then the one settled result
  })
})

describe('action="wait"', () => {
  test('publishes balanced waiting lifecycle around the action', async () => {
    const deps = fakeTerminal(['ready'])
    const lifecycle: unknown[] = []
    deps.onWait = (event) => lifecycle.push(event)

    await runTerminalAction(deps, {
      action: 'wait',
      terminal_id: 't1',
      wait_for: 'ready',
    })

    expect(lifecycle).toEqual([
      { terminalId: 't1', active: true, label: 'until text appears' },
      { terminalId: 't1', active: false, label: 'until text appears' },
    ])
  })

  test('publishes one safe input marker for keys/type without literal text', async () => {
    const deps = fakeTerminal(['done', 'done'])
    const lifecycle: unknown[] = []
    deps.onInput = (event) => lifecycle.push(event)

    const result = await runTerminalAction(deps, {
      action: 'keys',
      terminal_id: 't1',
      keys: ['hello-secret', 'Escape', 'Enter'],
    })

    expect(lifecycle).toEqual([{ terminalId: 't1', label: 'text Escape Enter' }])
    expect(JSON.stringify(lifecycle)).not.toContain('hello-secret')
    expect(result.content).toContain('Sent text Escape Enter')
    expect(result.content).not.toContain('hello-secret')
  })

  test('returns as soon as the text appears, and says so', async () => {
    const deps = fakeTerminal(['Compiling…', 'Compiling…', 'Compiled successfully'])
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'Compiled successfully',
    })

    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('appeared')
    expect(res.content).toContain('Compiled successfully') // the screen rides along
  })

  test('an already-satisfied condition costs no latency', async () => {
    // The first screen read already has it. A wait that slept anyway would charge
    // the agent for an answer it already had.
    const deps = fakeTerminal(['Compiled successfully'])
    const started = Date.now()
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'Compiled',
    })

    expect(res.content).toContain('appeared')
    expect(Date.now() - started).toBeLessThan(50)
  })

  test('wait_absent returns once the text is gone — the spinner case', async () => {
    const deps = fakeTerminal(['Installing…', 'Installing…', '$ '])
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'Installing',
      wait_absent: true,
    })

    expect(res.content).toContain('is gone')
  })

  test('a timeout is reported as a timeout, never as a match', async () => {
    // The whole point: the screen below the verdict looks like a normal screen.
    // If the verdict does not say TIMED OUT, the agent concludes the build passed.
    const deps = fakeTerminal(['Compiling…'])
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'Compiled successfully',
      wait_timeout_ms: 200,
    })

    expect(res.content).toContain('TIMED OUT')
    expect(res.content).toContain('never appeared')
    expect(res.isError).toBeFalsy() // still running is a legitimate answer, not a failure
  })

  test('with no wait_for it waits for quiet, and a never-quiet screen times out', async () => {
    const deps = fakeTerminal(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_timeout_ms: 200,
    })
    expect(res.content).toContain('TIMED OUT')
    expect(res.content).toContain('still producing')

    const quiet = fakeTerminal(['done', 'done'])
    const res2 = await waitForScreen(quiet, {
      terminalId: 't1',
      wait_timeout_ms: 2000,
    })
    expect(res2.content).toContain('went quiet')
  })

  test('a program that exits mid-wait is an answer, not an error', async () => {
    const deps = fakeTerminal(['running…', null])
    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'never',
    })

    expect(res.content).toContain('exited')
    expect(res.isError).toBeFalsy()
  })

  test('checks the retained final screen before reporting a fast process as exited', async () => {
    const deps = fakeTerminal(['PROMPT>', null])
    deps.finalScreen = async () => snap('PROMPT>DONE length=28')

    const res = await waitForScreen(deps, {
      terminalId: 't1',
      wait_for: 'DONE',
    })

    expect(res.content).toContain('"DONE" appeared')
    expect(res.content).toContain('DONE length=28')
    expect(res.content).not.toContain('terminal is closed')
  })

  test('an unknown terminal IS an error — nothing was ever waited on', async () => {
    const res = await waitForScreen(fakeTerminal([null]), {
      terminalId: 'gone',
      wait_for: 'x',
    })
    expect(res.isError).toBe(true)
  })

  test('wait_absent without wait_for is rejected rather than silently waiting for quiet', async () => {
    const res = await waitForScreen(fakeTerminal(['x']), {
      terminalId: 't1',
      wait_absent: true,
    })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('wait_absent requires wait_for')
  })

  test('the abort signal cuts the wait short', async () => {
    const controller = new AbortController()
    controller.abort()
    const started = Date.now()
    const res = await waitForScreen(
      fakeTerminal(['nope']),
      { terminalId: 't1', wait_for: 'yes', wait_timeout_ms: 5000 },
      controller.signal,
    )

    expect(Date.now() - started).toBeLessThan(500) // Stop must not wait out the timeout
    expect(res.content).toContain('INTERRUPTED')
    expect(res.content).toContain('terminal is still open')
    expect(res.content).not.toContain('TIMED OUT')
  })
})
