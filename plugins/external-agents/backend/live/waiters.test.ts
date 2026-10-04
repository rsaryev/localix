import { describe, expect, it, test } from 'bun:test'
import { LiveStore, MAX_CLOSED_KEPT } from './store'
import { ManifestRegistry } from '../detection/registry'
import { activeWaits, DEFAULT_WAIT_STATES, MIN_WAIT_MS, waitedKeys, waitForStates } from './waiters'
import { linkKeyOf } from '../../shared/identity'

function makeStore(): LiveStore {
  return new LiveStore(new ManifestRegistry('/nonexistent-state-dir', () => {}))
}

/**
 * Drive a link to a settled state through the store's own emit.
 *
 * `close()` is used rather than a state poke because these cases are about a WAIT observing a
 * transition, and a poke that does not emit would leave the waiter parked forever. A closed
 * terminal is `done` by the store's own rule — the honest settle available without screen
 * detection now that a delegation cannot report its own state.
 */
function settle(store: LiveStore, terminalId: string) {
  store.close(terminalId)
}

/** Open a delegation and force it into a known state without going through screen detection. */
function seed(
  store: LiveStore,
  terminalId: string,
  provider: string,
  state: 'working' | 'blocked' | 'idle',
) {
  const entry = store.open({ terminalId, localixSessionId: 'lx1', provider })
  entry.nativeSessionId = `native-${terminalId}`
  entry.state = state
  return linkKeyOf({ provider, nativeSessionId: `native-${terminalId}` })
}

describe('closed terminals', () => {
  it('only the most recent ones are kept, so the store does not grow for the process life', () => {
    const store = makeStore()
    const total = MAX_CLOSED_KEPT + 5
    for (let i = 0; i < total; i++) {
      seed(store, `t${i}`, 'claude-code', 'working')
      store.close(`t${i}`)
    }
    expect(store.get('t0')).toBeUndefined()
    expect(store.get(`t${total - 1}`)?.state).toBe('done')
  })
})

describe('a settle nobody observed says so', () => {
  /**
   * When no rule matches a screen, the evaluator degrades to `idle` for a known agent, and `idle`
   * is in the default target set, so the wait settles at once.
   *
   * For Claude Code that is EVERY non-blocked screen: its `working` state is read from the
   * terminal's OSC title, and the host's snapshot carries text, cursor and size but no title, so
   * there is no positive working signal to match. Of the 11 rules of a complete manifest we hold
   * 7, and the 3 absent OSC ones are the only source of `working`.
   *
   * So a wait on a busy delegation returns "settled" instantly. That cannot be fixed by refusing to
   * settle — a true idle at its prompt is equally unmatched, so the alternative is every Claude wait
   * timing out. What it can do is stop presenting the guess as an observation.
   */
  function seedFallbackIdle(store: LiveStore, terminalId: string) {
    const entry = store.open({ terminalId, localixSessionId: 'lx1', provider: 'claude-code' })
    entry.nativeSessionId = `native-${terminalId}`
    entry.state = 'idle'
    entry.explain = { ...entry.explain, state: 'idle', fallbackReason: 'no_rule_matched' }
    return linkKeyOf({ provider: 'claude-code', nativeSessionId: `native-${terminalId}` })
  }

  test('a fallback idle is reported as unconfirmed, not as a finished agent', async () => {
    const store = makeStore()
    const key = seedFallbackIdle(store, 't1')
    const outcome = await waitForStates(store, {
      keys: [key],
      mode: 'one',
      until: DEFAULT_WAIT_STATES,
      timeoutMs: 60_000,
    })

    expect(outcome.satisfied).toBe(true)
    expect(outcome.degraded).toEqual([key])
    // The sentence matters more than the field: a caller reading only the summary must still not
    // act on "it finished".
    expect(outcome.summary).toContain('no rule confirmed')
    expect(outcome.summary).toContain('may still be working')
  })

  test('an observed state carries no caveat', async () => {
    // The guard must not cry wolf: a rule-matched blocked is an observation and reads as one.
    const store = makeStore()
    const key = seed(store, 't1', 'claude-code', 'blocked')
    const outcome = await waitForStates(store, {
      keys: [key],
      mode: 'one',
      until: DEFAULT_WAIT_STATES,
      timeoutMs: 60_000,
    })
    expect(outcome.degraded).toEqual([])
    expect(outcome.summary).not.toContain('no rule confirmed')
  })
})

describe('waitForStates', () => {
  it('an already-aborted signal returns at once instead of sitting out the timeout', async () => {
    // `abort` fires once; a listener added after it never runs, so this waited the full timeout.
    const store = makeStore()
    const key = seed(store, 't1', 'claude-code', 'working')
    const controller = new AbortController()
    controller.abort()
    const outcome = await waitForStates(
      store,
      { keys: [key], mode: 'one', until: ['done'], timeoutMs: 60_000 },
      controller.signal,
    )
    expect(outcome.timedOut).toBe(false)
    expect(outcome.waitedMs).toBeLessThan(500)
  })

  it('returns immediately when the target already holds', async () => {
    const store = makeStore()
    const key = seed(store, 't1', 'claude-code', 'blocked')
    const outcome = await waitForStates(store, {
      keys: [key],
      mode: 'one',
      until: DEFAULT_WAIT_STATES,
      timeoutMs: 60_000,
    })
    expect(outcome.satisfied).toBe(true)
    expect(outcome.timedOut).toBe(false)
    expect(outcome.waitedMs).toBeLessThan(500)
  })

  it('ANY resolves as soon as the first of several links settles', async () => {
    const store = makeStore()
    const a = seed(store, 'ta', 'claude-code', 'working')
    const b = seed(store, 'tb', 'codex', 'working')
    const pending = waitForStates(store, {
      keys: [a, b],
      mode: 'any',
      until: ['done'],
      timeoutMs: 5_000,
    })
    setTimeout(() => settle(store, 'tb'), 20)
    const outcome = await pending
    expect(outcome.satisfied).toBe(true)
    expect(outcome.matched).toEqual([b])
    expect(outcome.states[a]).toBe('working')
  })

  it('ALL waits for every link, not just the first', async () => {
    const store = makeStore()
    const a = seed(store, 'ta', 'claude-code', 'working')
    const b = seed(store, 'tb', 'codex', 'working')
    const pending = waitForStates(store, {
      keys: [a, b],
      mode: 'all',
      until: ['done'],
      timeoutMs: 5_000,
    })
    setTimeout(() => settle(store, 'ta'), 10)
    setTimeout(() => settle(store, 'tb'), 40)
    const outcome = await pending
    expect(outcome.satisfied).toBe(true)
    expect([...outcome.matched].sort()).toEqual([a, b].sort())
  })

  it('ALL times out while any link is still working', async () => {
    const store = makeStore()
    const a = seed(store, 'ta', 'claude-code', 'working')
    const b = seed(store, 'tb', 'codex', 'working')
    setTimeout(() => settle(store, 'ta'), 10)
    const outcome = await waitForStates(store, {
      keys: [a, b],
      mode: 'all',
      until: ['done'],
      timeoutMs: 1_000,
    })
    expect(outcome.satisfied).toBe(false)
    expect(outcome.timedOut).toBe(true)
    expect(outcome.states[b]).toBe('working')
  })

  it('does not hang forever on ALL when one key has no live delegation', async () => {
    // The regression this guards: treating an unknown key as "never satisfied" makes every `all`
    // wait that includes a historical link run to the full timeout instead of resolving.
    const store = makeStore()
    const live = seed(store, 'ta', 'claude-code', 'idle')
    const historical = linkKeyOf({ provider: 'opencode', nativeSessionId: 'ses_not_running' })
    const outcome = await waitForStates(store, {
      keys: [live, historical],
      mode: 'all',
      until: DEFAULT_WAIT_STATES,
      timeoutMs: 5_000,
    })
    expect(outcome.satisfied).toBe(true)
    expect(outcome.waitedMs).toBeLessThan(500)
    expect(outcome.states[historical]).toBe('not-live')
  })

  it('reports every key’s final state in the outcome', async () => {
    const store = makeStore()
    const a = seed(store, 'ta', 'claude-code', 'working')
    const outcome = await waitForStates(store, {
      keys: [a],
      mode: 'one',
      until: ['done'],
      timeoutMs: 1_000,
    })
    expect(Object.keys(outcome.states)).toEqual([a])
    expect(outcome.summary).toContain('Timed out')
  })

  it('closing the terminal settles a waiter', async () => {
    const store = makeStore()
    const a = seed(store, 'ta', 'claude-code', 'working')
    const pending = waitForStates(store, {
      keys: [a],
      mode: 'one',
      until: ['done'],
      timeoutMs: 5_000,
    })
    setTimeout(() => store.close('ta'), 20)
    const outcome = await pending
    expect(outcome.satisfied).toBe(true)
  })
})

describe('what an orchestrator is waiting on', () => {
  test('an in-flight wait is visible while it blocks, and gone the moment it settles', async () => {
    // A wait is invisible by construction — the model calls it and its turn stops. Without this
    // registry the person beside it sees three terminals and no reason nobody is acting on them.
    const live = makeStore()
    live.open({ terminalId: 't1', localixSessionId: 's', provider: 'claude-code' })
    const key = live.keyOf(live.get('t1')!)

    const pending = waitForStates(live, {
      keys: [key],
      mode: 'all',
      until: ['done'],
      timeoutMs: 60_000,
    })
    expect([...waitedKeys()]).toEqual([key])
    expect(activeWaits()[0]).toMatchObject({ mode: 'all', keys: [key] })

    live.close('t1')
    await pending
    expect(waitedKeys().size).toBe(0)
    expect(activeWaits()).toHaveLength(0)
  })

  test('a wait whose condition already holds is never registered', async () => {
    // It resolves in the same frame, so showing it would be a marker that appears and vanishes.
    const live = makeStore()
    await waitForStates(live, {
      keys: ['absent:x'],
      mode: 'any',
      until: ['done'],
      timeoutMs: 1_000,
    })
    expect(activeWaits()).toHaveLength(0)
  })
})

describe('a wait can see a screen change while it is waiting', () => {
  test('without a reader, a screen-detected transition never wakes the wait', async () => {
    // The structural gap the terminal reader closes: waiters wake on `live.onChange`, and until the
    // host exposed a reader the only thing that fired it was the MODEL running a bash action — which
    // it cannot do while blocked inside this very call.
    const live = makeStore()
    live.open({ terminalId: 't1', localixSessionId: 's', provider: 'claude-code' })
    const key = live.keyOf(live.get('t1')!)

    const outcome = await waitForStates(live, {
      keys: [key],
      mode: 'all',
      until: ['blocked'],
      timeoutMs: 1_000,
    })
    expect(outcome.timedOut).toBe(true)
    expect(outcome.satisfied).toBe(false)
  })

  test('an observation arriving mid-wait settles it', async () => {
    // Which is exactly what the service now produces, by polling the panes it is waiting on.
    const live = makeStore()
    live.open({ terminalId: 't1', localixSessionId: 's', provider: 'claude-code' })
    const key = live.keyOf(live.get('t1')!)

    const pending = waitForStates(live, {
      keys: [key],
      mode: 'all',
      until: ['blocked'],
      timeoutMs: 5_000,
    })
    // A real Claude Code approval menu, matched by its bundled manifest.
    setTimeout(
      () => live.observeScreen('t1', 'enter to select · esc to cancel · ↑↓ to navigate'),
      20,
    )
    const outcome = await pending
    expect(outcome.timedOut).toBe(false)
    expect(outcome.satisfied).toBe(true)
  })
})

describe('a timeout says what IS happening, not only what did not', () => {
  /**
   * A wait that expires reported the states it was still waiting on — which names what failed to
   * happen and nothing about why. A screen that has stopped moving is the difference between an agent
   * that is thinking and one waiting on something nobody will give it, and for Claude Code it is the
   * only evidence there is: its manifest yields no positive `working` state.
   *
   * Symphony treats the same measure as a stall and kills the worker; a delegation here belongs to
   * whoever launched it, so this reports and lets them decide.
   */
  test('a still screen is named in the timeout, with how long', async () => {
    const store = new LiveStore(new ManifestRegistry('/tmp/ea-wait-still', () => {}))
    store.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    store.adopt('t1', 'sess')
    store.observeScreen('t1', 'thinking')
    const entry = store.byKey('claude-code:sess')
    // Pushed back past the shared floor, which is the only thing that makes stillness worth saying.
    if (entry) entry.lastChangeAt = Date.now() - 12 * 60_000

    const outcome = await waitForStates(store, {
      keys: ['claude-code:sess'],
      mode: 'all',
      until: ['blocked'],
      timeoutMs: MIN_WAIT_MS,
    })

    expect(outcome.timedOut).toBe(true)
    expect(outcome.summary).toContain('Screens unchanged')
    expect(outcome.summary).toContain('claude-code:sess for 12m')
  })

  test('a screen that moved recently adds nothing to the timeout', async () => {
    const store = new LiveStore(new ManifestRegistry('/tmp/ea-wait-moving', () => {}))
    store.open({ terminalId: 't2', localixSessionId: 'lx-1', provider: 'claude-code' })
    store.adopt('t2', 'fresh')
    store.observeScreen('t2', 'thinking')

    const outcome = await waitForStates(store, {
      keys: ['claude-code:fresh'],
      mode: 'all',
      until: ['blocked'],
      timeoutMs: MIN_WAIT_MS,
    })

    expect(outcome.timedOut).toBe(true)
    expect(outcome.summary).not.toContain('Screens unchanged')
  })
})
