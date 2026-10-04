import { describe, expect, test } from 'bun:test'
import { createLivenessRegistry } from './registry'
import type { LivenessState } from './types'

/** A controllable clock + timer queue: the whole policy is schedule-shaped, so real time
 *  would only make these tests slow and flaky. */
function harness(answers: boolean[], policy = {}) {
  let clock = 1_000
  let cost = 0
  const timers: Array<{ at: number; run: () => void }> = []
  let asked = 0
  const registry = createLivenessRegistry({
    policy: { periodMs: 1_000, maxPeriodMs: 10_000, costFactor: 20, ...policy },
    now: () => clock,
    setTimer: (run, delayMs) => {
      const timer = { at: clock + delayMs, run }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer as { at: number; run: () => void })
      if (index >= 0) timers.splice(index, 1)
    },
  })
  const probe = async () => {
    asked += 1
    clock += cost
    return answers.length > 1 ? answers.shift()! : answers[0]!
  }
  return {
    registry,
    target: { kind: 'custom' as const, probe },
    get asked() {
      return asked
    },
    /** Cost charged to each probe, so the adaptive delay can be observed. */
    setCost(ms: number) {
      cost = ms
    },
    /** Run every timer due at or before `clock + advanceMs`, one round. */
    async tick(advanceMs: number) {
      clock += advanceMs
      const due = timers.filter((timer) => timer.at <= clock)
      for (const timer of due) {
        timers.splice(timers.indexOf(timer), 1)
        timer.run()
      }
      await Promise.resolve()
      await Promise.resolve()
    },
    nextDelay: () => (timers[0] ? timers[0].at - clock : null),
  }
}

const states = () => {
  const seen: LivenessState[] = []
  return { seen, listener: (state: LivenessState) => seen.push(state) }
}

describe('liveness registry', () => {
  test('probes once for many subscribers and stops when the last one leaves', async () => {
    const h = harness([true])
    const a = states()
    const b = states()

    const releaseA = h.registry.watch('dev', h.target, a.listener)
    const releaseB = h.registry.watch('dev', h.target, b.listener)
    await h.tick(0)

    expect(h.asked).toBe(1)
    expect(h.registry.size()).toBe(1)
    expect(a.seen.at(-1)?.alive).toBe(true)
    expect(b.seen.at(-1)?.alive).toBe(true)

    releaseA()
    await h.tick(1_000)
    expect(h.asked).toBe(2)

    releaseB()
    await h.tick(5_000)
    // Nothing is watching: nothing is asked, and the entry is gone rather than stale.
    expect(h.asked).toBe(2)
    expect(h.registry.size()).toBe(0)
    expect(h.registry.peek('dev')).toBeUndefined()
  })

  test('publishes transitions only, and holds a live endpoint through one lost probe', async () => {
    const h = harness([true, false, false, true], { failureThreshold: 2 })
    const { seen, listener } = states()

    h.registry.watch('dev', h.target, listener)
    await h.tick(0)
    expect(seen.map((s) => s.alive)).toEqual([true])

    // One failure is a blip — a rebuild, a dropped connect — and must not report a dead server.
    await h.tick(1_000)
    expect(seen).toHaveLength(1)

    // The second consecutive one is the answer.
    await h.tick(1_000)
    expect(seen.map((s) => s.alive)).toEqual([true, false])

    await h.tick(1_000)
    expect(seen.map((s) => s.alive)).toEqual([true, false, true])
  })

  test('a "down" report is checked at once and, confirmed, skips the threshold', async () => {
    const h = harness([true, false], { failureThreshold: 5 })
    const { seen, listener } = states()
    h.registry.watch('dev', h.target, listener)
    await h.tick(0)
    expect(seen.map((s) => s.alive)).toEqual([true])

    // The process that served this just exited. The check runs NOW, not on the next period,
    // and one refused connect on top of the owner's word is enough to publish.
    h.registry.report('dev', false)
    await Promise.resolve()
    await Promise.resolve()

    expect(h.asked).toBe(2)
    expect(seen.map((s) => s.alive)).toEqual([true, false])
    expect(seen.at(-1)?.source).toBe('report')
  })

  test('a "down" report about a server that is up does not flicker the state', async () => {
    // A port scan that missed the listener for one pass, a shell that exited while its
    // daemonised server kept the port: both reported "down" about a live server, and the next
    // probe reported "up" — two transitions for nothing. The probe is asked first.
    const h = harness([true], { failureThreshold: 5 })
    const { seen, listener } = states()
    h.registry.watch('dev', h.target, listener)
    await h.tick(0)

    h.registry.report('dev', false)
    await Promise.resolve()
    await Promise.resolve()

    expect(h.asked).toBe(2)
    expect(seen.map((s) => s.alive)).toEqual([true])
  })

  test('an "up" report is believed at once — a listener appearing is what it says', async () => {
    const h = harness([false, false], { successThreshold: 3 })
    const { seen, listener } = states()
    h.registry.watch('dev', h.target, listener)
    await h.tick(0)

    h.registry.report('dev', true)

    expect(seen.map((s) => s.alive)).toEqual([false, true])
    expect(seen.at(-1)?.source).toBe('report')
  })

  test('a slow probe stretches its own period instead of eating the machine', async () => {
    const h = harness([true])
    h.registry.watch('dev', h.target, () => {})
    await h.tick(0)
    expect(h.nextDelay()).toBe(1_000) // cheap probe → the floor

    // A probe that turns expensive stretches the period toward cost × 20 (6 s here) over a
    // few samples rather than on the first one, so a single slow check cannot stall the watch.
    h.setCost(300)
    const ramp: number[] = []
    for (let round = 0; round < 5; round++) {
      await h.tick(h.nextDelay() ?? 0)
      ramp.push(h.nextDelay() ?? 0)
    }
    expect(ramp).toEqual([...ramp].sort((a, b) => a - b))
    expect(ramp.at(-1)).toBeGreaterThan(3_000)
    expect(ramp.at(-1)).toBeLessThanOrEqual(6_000)

    h.setCost(60_000)
    for (let round = 0; round < 5; round++) await h.tick(h.nextDelay() ?? 0)
    expect(h.nextDelay()).toBe(10_000) // capped, never unbounded
  })

  test('a reported-only target never schedules a probe', async () => {
    const h = harness([true])
    const { seen, listener } = states()

    h.registry.watch('static', { kind: 'reported' }, listener)
    await h.tick(10_000)
    expect(h.asked).toBe(0)
    expect(seen).toHaveLength(0)

    h.registry.report('static', true)
    expect(seen.map((s) => s.alive)).toEqual([true])
  })
})
