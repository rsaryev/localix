import { afterEach, expect, spyOn, test } from 'bun:test'
import { startWaitPoll, type WatchScreen } from './wait-poll'

const request = { keys: ['codex:one'], mode: 'all', until: ['done'], timeoutMs: 30_000 } as const

let release: (() => void) | undefined
afterEach(() => {
  release?.()
  release = undefined
})

/** A wait on one pane whose output and exit the test fires by hand, on a frozen clock. */
function arm(options: { watchable?: boolean } = {}) {
  const calls: string[] = []
  let emit: (event: 'output' | 'exit') => void = () => {}
  const watchScreen: WatchScreen = (key, sessionId, onEvent) => {
    calls.push(`watch:${key}:${sessionId}`)
    if (options.watchable === false) return null
    emit = onEvent
    return () => calls.push('watch.close')
  }
  release = startWaitPoll({
    request,
    sessionId: 'asking',
    hasTerminalRead: () => true,
    watchScreen,
    readScreen: async (key) => {
      calls.push(`screen:${key}`)
      return null
    },
    readEnd: async (key) => void calls.push(`end:${key}`),
    readTurnsFor: async (keys) => void calls.push(`turns:${keys.join(',')}`),
    timers: () => new Set(),
    sourcePath: () => undefined,
    watchPath: () => () => () => {},
    screenGapMs: 1_000,
    now: () => 5_000,
  })
  return { calls, emit: (event: 'output' | 'exit') => emit(event) }
}

test('pane output re-reads its screen and log, without any interval', () => {
  const interval = spyOn(globalThis, 'setInterval')
  try {
    const { calls, emit } = arm()
    emit('output')
    expect(calls).toEqual(['watch:codex:one:asking', 'screen:codex:one', 'turns:codex:one'])
    expect(interval).not.toHaveBeenCalled()
  } finally {
    interval.mockRestore()
  }
})

test('a burst of output inside the window costs one read, and release drops the trailing one', () => {
  const { calls, emit } = arm()
  emit('output')
  emit('output')
  emit('output')
  expect(calls.filter((call) => call.startsWith('screen'))).toEqual(['screen:codex:one'])
  release?.()
  expect(calls.at(-1)).toBe('watch.close')
})

test('an exit takes the final reading at once', () => {
  const { calls, emit } = arm()
  emit('output')
  emit('output')
  emit('exit')
  expect(calls.slice(-1)).toEqual(['end:codex:one'])
  expect(calls.filter((call) => call.startsWith('screen'))).toHaveLength(1)
})

test('a pane that is already gone is read as ended', () => {
  const { calls } = arm({ watchable: false })
  expect(calls).toEqual(['watch:codex:one:asking', 'end:codex:one'])
})

test('without pane events the wait falls back to the timer', () => {
  let tick = () => {}
  const handle = {} as ReturnType<typeof setInterval>
  const interval = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
    tick = callback
    return handle
  }) as typeof setInterval)
  const clear = spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
  try {
    const calls: string[] = []
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const stop = startWaitPoll({
      request,
      hasTerminalRead: () => true,
      readScreen: async (key) => {
        calls.push(`screen:${key}`)
        return null
      },
      readEnd: async () => {},
      readTurnsFor: async (keys) => void calls.push(`turns:${keys.join(',')}`),
      timers: () => timers,
      sourcePath: () => undefined,
      watchPath: () => () => () => {},
    })
    tick()
    expect(calls).toEqual(['screen:codex:one', 'turns:codex:one'])
    expect(timers.size).toBe(1)
    stop()
    expect(clear).toHaveBeenCalledWith(handle)
    expect(timers.size).toBe(0)
  } finally {
    interval.mockRestore()
    clear.mockRestore()
  }
})
