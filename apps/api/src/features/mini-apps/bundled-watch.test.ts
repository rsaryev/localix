import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { NativeSubscribeOptions, NativeWatchEvent } from '../fs-watch/subscribe'
import { watchStagedMiniAppsRoot } from './bundled-watch'
import { STAGED_MARKER_FILE } from './staged-marker'

const ROOT = '/staged/mini-apps'

/** A native-subscription port the test drives: emit events, fail it, observe close. */
function fakeSubscribe(opts: { failOnSubscribe?: boolean } = {}) {
  let onEvents: ((events: NativeWatchEvent[]) => void) | undefined
  let onError: NativeSubscribeOptions['onError']
  let closed = false
  const subscribe = (
    _root: string,
    events: (events: NativeWatchEvent[]) => void,
    o: NativeSubscribeOptions = {},
  ) => {
    onEvents = events
    onError = o.onError
    if (opts.failOnSubscribe) o.onError?.(new Error('no native file watcher'))
    return {
      close() {
        closed = true
      },
    }
  }
  return {
    subscribe,
    emit: (...names: string[]) =>
      onEvents?.(names.map((name) => ({ path: join(ROOT, name), type: 'update' as const }))),
    fail: (message: string) => onError?.(new Error(message)),
    isClosed: () => closed,
  }
}

/** Timers the test fires by hand; only the last scheduled one is the live debounce. */
function manualTimers() {
  const timers: (() => void)[] = []
  const setTimer = ((fn: () => void) => {
    timers.push(fn)
    return timers.length
  }) as never
  return { setTimer, timers, fireLast: () => timers.at(-1)?.() }
}

/** A poll port: `tick` runs the registered check; `running` says whether polling is on. */
function manualPoll() {
  let tick: (() => void) | undefined
  let running = false
  const every = (fn: () => void) => {
    tick = fn
    running = true
    return () => {
      running = false
    }
  }
  return { every, tick: () => tick?.(), running: () => running }
}

describe('staged mini apps root watcher', () => {
  test('a settled marker rewrite raises exactly one change; other files in the root do not', () => {
    const fake = fakeSubscribe()
    const t = manualTimers()
    let changes = 0
    let revision = 'before'
    const handle = watchStagedMiniAppsRoot({
      root: ROOT,
      onChange: () => changes++,
      subscribe: fake.subscribe,
      revision: () => revision,
      setTimer: t.setTimer,
    })
    // Staging copies many files before it writes the marker; none of them is the signal, and
    // a nested file NAMED like the marker is not the root's marker either.
    fake.emit('gpu-monitor/mini-app.json', 'gpu-monitor/backend/index.bundle.mjs')
    fake.emit(`gpu-monitor/${STAGED_MARKER_FILE}`)
    expect(t.timers).toHaveLength(0)
    // The marker is rewritten twice in quick succession (two mini apps re-staged).
    fake.emit(STAGED_MARKER_FILE)
    fake.emit(STAGED_MARKER_FILE)
    revision = 'after'
    expect(t.timers).toHaveLength(2)
    t.fireLast()
    expect(changes).toBe(1)
    handle.close()
    expect(fake.isClosed()).toBe(true)
  })

  test('atomic rename reported only as a temporary filename reads the completed marker', () => {
    const fake = fakeSubscribe()
    const t = manualTimers()
    let revision: string | null = 'before'
    let changes = 0
    const handle = watchStagedMiniAppsRoot({
      root: ROOT,
      subscribe: fake.subscribe,
      revision: () => revision,
      onChange: () => changes++,
      setTimer: t.setTimer,
    })
    fake.emit(`${STAGED_MARKER_FILE}.123.tmp`)
    t.fireLast()
    expect(changes).toBe(0)
    revision = 'after'
    fake.emit(`${STAGED_MARKER_FILE}.123.tmp`)
    t.fireLast()
    expect(changes).toBe(1)
    fake.emit(STAGED_MARKER_FILE)
    t.fireLast()
    expect(changes).toBe(1)
    revision = null
    fake.emit(`${STAGED_MARKER_FILE}.123.tmp`)
    t.fireLast()
    expect(changes).toBe(1)
    handle.close()
  })

  // The native watcher reports a loss instead of going quiet, so polling is not needed while it
  // is healthy — and is exactly what a reported failure switches to.
  test('no poll while the native watch is healthy', () => {
    const poll = manualPoll()
    const handle = watchStagedMiniAppsRoot({
      root: ROOT,
      onChange: () => {},
      subscribe: fakeSubscribe().subscribe,
      every: poll.every,
    })
    expect(poll.running()).toBe(false)
    handle.close()
  })

  test('a reported drop re-reads the marker at once, then keeps polling it', () => {
    const fake = fakeSubscribe()
    const poll = manualPoll()
    const lines: string[] = []
    let revision = 'before'
    let changes = 0
    const handle = watchStagedMiniAppsRoot({
      root: ROOT,
      subscribe: fake.subscribe,
      revision: () => revision,
      onChange: () => changes++,
      every: poll.every,
      log: (line) => lines.push(line),
    })
    // The rewrite whose event the overflow swallowed.
    revision = 'after'
    fake.fail('Events were dropped by the kernel. File system must be re-scanned.')
    expect(changes).toBe(1)
    expect(lines[0]).toContain('polling the marker')
    expect(poll.running()).toBe(true)
    revision = 'later'
    poll.tick()
    expect(changes).toBe(2)
    poll.tick() // seen once is seen
    expect(changes).toBe(2)
    handle.close()
    expect(poll.running()).toBe(false)
  })

  test('no native watcher on this platform: reported, not thrown, and polled', () => {
    const poll = manualPoll()
    const lines: string[] = []
    const handle = watchStagedMiniAppsRoot({
      root: ROOT,
      onChange: () => {},
      subscribe: fakeSubscribe({ failOnSubscribe: true }).subscribe,
      every: poll.every,
      log: (line) => lines.push(line),
    })
    expect(lines[0]).toContain('no native file watcher')
    expect(poll.running()).toBe(true)
    handle.close()
  })
})
