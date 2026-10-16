import { describe, expect, test } from 'bun:test'
import { createReloadGuard } from './reloadGuard'

/** A deterministic fake clock + timer queue so the debounce/settle windows are
 *  tested without wall-clock waits. */
function fakeScheduler() {
  let clock = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq
      timers.set(id, { at: clock + ms, fn })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (h: ReturnType<typeof setTimeout>) => {
      timers.delete(h as unknown as number)
    },
    /** Advance the clock, firing every timer whose deadline has passed (in order). */
    advance(ms: number) {
      clock += ms
      let due = [...timers.entries()]
        .filter(([, t]) => t.at <= clock)
        .sort((a, b) => a[1].at - b[1].at)
      while (due.length) {
        for (const [id, t] of due) {
          timers.delete(id)
          t.fn()
        }
        due = [...timers.entries()]
          .filter(([, t]) => t.at <= clock)
          .sort((a, b) => a[1].at - b[1].at)
      }
    },
  }
}

const opts = (s: ReturnType<typeof fakeScheduler>) => ({
  now: s.now,
  setTimer: s.setTimer,
  clearTimer: s.clearTimer,
  debounceMs: 250,
  settleMs: 500,
})

describe('reloadGuard — per-path debounce', () => {
  test('coalesces a burst of signals into a single reload', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    let runs = 0
    guard.scheduleReload('/a.ts', () => runs++)
    guard.scheduleReload('/a.ts', () => runs++)
    guard.scheduleReload('/a.ts', () => runs++)
    expect(runs).toBe(0) // nothing fires before the window elapses
    s.advance(250)
    expect(runs).toBe(1) // three signals → one reload
  })

  test('independent paths debounce independently', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    const runs: string[] = []
    guard.scheduleReload('/a.ts', () => runs.push('a'))
    guard.scheduleReload('/b.ts', () => runs.push('b'))
    s.advance(250)
    expect(runs.sort()).toEqual(['a', 'b'])
  })

  test('cancel drops a pending reload (unmount)', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    let runs = 0
    guard.scheduleReload('/a.ts', () => runs++)
    guard.cancel('/a.ts')
    s.advance(250)
    expect(runs).toBe(0)
  })
})

describe('reloadGuard — save-settle window (hold reloads until the save commits)', () => {
  test('isSettling is true within the window and false after', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    guard.markSaving('/a.ts')
    expect(guard.isSettling('/a.ts')).toBe(true)
    s.advance(499)
    expect(guard.isSettling('/a.ts')).toBe(true)
    s.advance(2) // past 500ms
    expect(guard.isSettling('/a.ts')).toBe(false)
  })

  test('a reload scheduled during the settle window is HELD until it closes, never dropped', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    let runs = 0
    guard.markSaving('/a.ts') // local save in flight
    guard.scheduleReload('/a.ts', () => runs++) // its fs echo — or an agent's write — arrives
    s.advance(250) // debounce fires while still settling
    expect(runs).toBe(0) // not against the not-yet-committed base hash
    s.advance(250) // settle window closes
    // Runs once: an agent write that landed right after a save used to be dropped here,
    // leaving the tab stale; the self-save echo it also covers reads back as "unchanged".
    expect(runs).toBe(1)
  })

  test('a save that starts while a reload is held extends the hold', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    let runs = 0
    guard.markSaving('/a.ts')
    guard.scheduleReload('/a.ts', () => runs++)
    s.advance(400)
    guard.markSaving('/a.ts') // a second save (auto-save) opens a fresh window
    s.advance(200)
    expect(runs).toBe(0)
    s.advance(300)
    expect(runs).toBe(1)
  })

  test('a reload after the settle window elapses runs normally', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    let runs = 0
    guard.markSaving('/a.ts')
    s.advance(600) // settle window closed
    guard.scheduleReload('/a.ts', () => runs++)
    s.advance(250)
    expect(runs).toBe(1)
  })

  test('settling one path does not suppress another', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    let runs = 0
    guard.markSaving('/a.ts')
    guard.scheduleReload('/b.ts', () => runs++)
    s.advance(250)
    expect(runs).toBe(1) // /b.ts is unaffected by /a.ts settling
  })
})

describe('reloadGuard — reset', () => {
  test('reset clears pending timers and settle windows', () => {
    const s = fakeScheduler()
    const guard = createReloadGuard(opts(s))
    let runs = 0
    guard.markSaving('/a.ts')
    guard.scheduleReload('/b.ts', () => runs++)
    guard.reset()
    s.advance(1000)
    expect(runs).toBe(0)
    expect(guard.isSettling('/a.ts')).toBe(false)
  })
})
