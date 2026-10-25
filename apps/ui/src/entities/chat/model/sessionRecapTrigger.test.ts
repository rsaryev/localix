import { describe, expect, test } from 'bun:test'
import { RECAP_AFTER_MS } from '@localixai/api/session-recap'
import { createSessionRecapTrigger, type RecapSessionState } from './sessionRecapTrigger'

/** A clock and a focus signal the test moves by hand: nothing here waits. */
function world(start = 1_000_000) {
  let now = start
  let focused = true
  const timers = new Map<number, { at: number; run: () => void }>()
  const focusListeners = new Set<() => void>()
  let nextId = 1
  const requested: string[] = []
  const trigger = createSessionRecapTrigger({
    clock: {
      now: () => now,
      setTimeout: (run, ms) => {
        const id = nextId++
        timers.set(id, { at: now + ms, run })
        return id
      },
      clearTimeout: (id) => void timers.delete(id as number),
    },
    focus: {
      isFocused: () => focused,
      subscribe: (listener) => {
        focusListeners.add(listener)
        return () => focusListeners.delete(listener)
      },
    },
    request: (sessionId) => void requested.push(sessionId),
  })
  return {
    trigger,
    requested,
    pending: () => timers.size,
    advance(ms: number) {
      const to = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= to)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].run()
      }
      now = to
    },
    setFocus(next: boolean) {
      focused = next
      for (const listener of focusListeners) listener()
    },
    at: () => now,
  }
}

const idle = (updatedAtMs: number, sessionId = 's1'): RecapSessionState => ({
  sessionId,
  running: false,
  updatedAtMs,
})

/** A turn that runs and finishes while the window watches. */
function finishTurn(w: ReturnType<typeof world>, sessionId = 's1') {
  w.trigger.update({ sessionId, running: true, updatedAtMs: null })
  w.trigger.update(idle(0, sessionId))
}

describe('automatic recap trigger', () => {
  test('asks once the window has been unfocused until three minutes after the last turn', () => {
    const w = world()
    w.trigger.update(idle(w.at()))
    w.setFocus(false)

    w.advance(RECAP_AFTER_MS - 1)
    expect(w.requested).toEqual([])
    w.advance(1)
    expect(w.requested).toEqual(['s1'])
  })

  test('counts the break from the last turn, not from the moment the person looked away', () => {
    const w = world()
    w.trigger.update(idle(w.at() - 2 * 60_000))
    w.setFocus(false)

    w.advance(RECAP_AFTER_MS - 2 * 60_000)
    expect(w.requested).toEqual(['s1'])
  })

  test('never asks while the window is focused, or when the person comes back first', () => {
    const w = world()
    w.trigger.update(idle(w.at()))
    w.advance(RECAP_AFTER_MS * 2)
    expect(w.requested).toEqual([])

    finishTurn(w)
    w.setFocus(false)
    w.advance(RECAP_AFTER_MS - 1000)
    w.setFocus(true)
    w.advance(RECAP_AFTER_MS)
    expect(w.requested).toEqual([])
    expect(w.pending()).toBe(0)
  })

  test('waits for a running turn to finish, then counts three minutes from then', () => {
    const w = world()
    w.setFocus(false)
    w.trigger.update({ sessionId: 's1', running: true, updatedAtMs: null })
    w.advance(RECAP_AFTER_MS * 5)
    expect(w.requested).toEqual([])

    // The server's timestamp of the finished turn is stale by now; the window saw it end.
    w.trigger.update(idle(0))
    w.advance(RECAP_AFTER_MS - 1)
    expect(w.requested).toEqual([])
    w.advance(1)
    expect(w.requested).toEqual(['s1'])
  })

  test('asks once per finished turn, and again after the next one', () => {
    const w = world()
    w.setFocus(false)
    w.trigger.update(idle(w.at()))
    w.advance(RECAP_AFTER_MS)
    w.trigger.update(idle(w.at() - RECAP_AFTER_MS))
    w.advance(RECAP_AFTER_MS * 3)
    expect(w.requested).toEqual(['s1'])

    finishTurn(w)
    w.advance(RECAP_AFTER_MS)
    expect(w.requested).toEqual(['s1', 's1'])
  })

  test('follows the conversation on screen', () => {
    const w = world()
    w.setFocus(false)
    w.trigger.update(idle(w.at(), 's1'))
    w.advance(RECAP_AFTER_MS / 2)
    w.trigger.update(idle(w.at(), 's2'))
    w.advance(RECAP_AFTER_MS)
    expect(w.requested).toEqual(['s2'])
    w.trigger.update({ sessionId: null, running: false, updatedAtMs: null })
    expect(w.pending()).toBe(0)
  })

  test('stops everything when disposed', () => {
    const w = world()
    w.setFocus(false)
    w.trigger.update(idle(w.at()))
    w.trigger.dispose()
    w.advance(RECAP_AFTER_MS * 2)
    expect(w.requested).toEqual([])
  })
})
