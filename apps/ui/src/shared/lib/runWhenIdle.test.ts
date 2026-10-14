import { expect, test } from 'bun:test'
import {
  IDLE_FALLBACK_DELAY_MS,
  IDLE_TIMEOUT_MS,
  installWhenIdle,
  runWhenIdle,
  type IdleSchedulerHost,
} from './runWhenIdle'

/** A host that speaks `requestIdleCallback`, like a Chromium webview. */
function idleCapableHost() {
  const scheduled = new Map<number, () => void>()
  const cancelled: number[] = []
  const timeouts: (number | undefined)[] = []
  let seq = 0
  const host: IdleSchedulerHost = {
    requestIdleCallback(callback, options) {
      seq += 1
      scheduled.set(seq, callback)
      timeouts.push(options?.timeout)
      return seq
    },
    cancelIdleCallback(handle) {
      cancelled.push(handle)
      scheduled.delete(handle)
    },
    setTimeout() {
      throw new Error('setTimeout fallback must not be used when idle callbacks exist')
    },
    clearTimeout() {},
  }
  return {
    host,
    timeouts,
    cancelled,
    flush: () => {
      const due = Array.from(scheduled.values())
      scheduled.clear()
      for (const callback of due) callback()
    },
  }
}

/**
 * A host with NO idle scheduler — WebKit, which is what the macOS desktop shell
 * runs. This is a real production path, so it gets the same coverage.
 */
function timeoutOnlyHost() {
  const scheduled = new Map<number, { callback: () => void; ms: number }>()
  let seq = 0
  const host: IdleSchedulerHost = {
    setTimeout(callback, ms) {
      seq += 1
      scheduled.set(seq, { callback, ms })
      return seq
    },
    clearTimeout(handle) {
      scheduled.delete(handle as unknown as number)
    },
  }
  return {
    host,
    delays: () => Array.from(scheduled.values(), (entry) => entry.ms),
    flush: () => {
      const due = Array.from(scheduled.values())
      scheduled.clear()
      for (const { callback } of due) callback()
    },
  }
}

test('the idle path defers the callback and passes a starvation timeout', () => {
  const { host, flush, timeouts } = idleCapableHost()
  let ran = 0
  runWhenIdle(
    () => {
      ran += 1
    },
    { host },
  )

  expect(ran).toBe(0)
  expect(timeouts).toEqual([IDLE_TIMEOUT_MS])
  flush()
  expect(ran).toBe(1)
})

test('the callback still runs when requestIdleCallback is absent', () => {
  const { host, delays, flush } = timeoutOnlyHost()
  let ran = 0
  runWhenIdle(
    () => {
      ran += 1
    },
    { host },
  )

  expect(ran).toBe(0)
  // Bounded, not "eventually": the deferral gap is what every call site's risk
  // statement is measured against.
  expect(delays()).toEqual([IDLE_FALLBACK_DELAY_MS])
  flush()
  expect(ran).toBe(1)
})

test('a host that can schedule but not cancel takes the fallback path', () => {
  // Otherwise `cancel()` could not keep its guarantee through the handle alone.
  const { host, flush } = timeoutOnlyHost()
  let ran = 0
  runWhenIdle(
    () => {
      ran += 1
    },
    { host: { ...host, requestIdleCallback: () => 1 } },
  )
  flush()
  expect(ran).toBe(1)
})

test('cancel keeps the callback from running on both paths', () => {
  for (const scheduler of [idleCapableHost(), timeoutOnlyHost()]) {
    let ran = 0
    const handle = runWhenIdle(
      () => {
        ran += 1
      },
      { host: scheduler.host },
    )
    handle.cancel()
    handle.cancel() // idempotent
    scheduler.flush()
    expect(ran).toBe(0)
  }
})

test('installWhenIdle stages the install and disposes it after it ran', () => {
  const { host, flush } = idleCapableHost()
  const events: string[] = []
  const cleanup = installWhenIdle(
    () => {
      events.push('install')
      return () => events.push('dispose')
    },
    { host },
  )

  expect(events).toEqual([])
  flush()
  expect(events).toEqual(['install'])
  cleanup()
  expect(events).toEqual(['install', 'dispose'])
})

test('cleanup before the idle callback cancels the install outright', () => {
  // StrictMode mounts, unmounts and remounts every effect long before an idle
  // callback fires; a stranded install would leak a duplicate listener.
  const { host, flush, cancelled } = idleCapableHost()
  const events: string[] = []
  const cleanup = installWhenIdle(
    () => {
      events.push('install')
      return () => events.push('dispose')
    },
    { host },
  )

  cleanup()
  flush()
  expect(events).toEqual([])
  expect(cancelled).toHaveLength(1)
})

test('cleanup is safe to call twice after the install ran', () => {
  const { host, flush } = timeoutOnlyHost()
  let disposals = 0
  const cleanup = installWhenIdle(
    () => () => {
      disposals += 1
    },
    { host },
  )
  flush()
  cleanup()
  cleanup()
  expect(disposals).toBe(1)
})
