import { expect, test } from 'bun:test'
import { createSystemApi, MAX_TIMERS, MIN_EVERY_MS, type Schedule } from './system-api'

/** A hand-driven schedule: `tick()` fires every pending timer once. */
function manualSchedule() {
  const pending = new Set<{ fire: () => void; repeat: boolean }>()
  const schedule: Schedule = (fire, _ms, repeat) => {
    const entry = { fire, repeat }
    pending.add(entry)
    return () => pending.delete(entry)
  }
  const tick = () => {
    for (const entry of Array.from(pending)) {
      if (!entry.repeat) pending.delete(entry)
      entry.fire()
    }
  }
  return { schedule, tick, size: () => pending.size }
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

test('clock.after and every answer a timer whose cancel() stops it, as Claude Code mods call it', () => {
  const clock = manualSchedule()
  const system = createSystemApi({ cwd: () => '/', schedule: clock.schedule })
  const fired: string[] = []
  const once = system.clock.after(10, () => fired.push('after'))
  const poll = system.clock.every(10, () => fired.push('every'))
  expect(typeof once.cancel).toBe('function')
  expect(typeof poll.cancel).toBe('function')
  clock.tick()
  clock.tick()
  expect(fired).toEqual(['after', 'every', 'every'])
  poll.cancel()
  once.cancel()
  clock.tick()
  expect(fired).toEqual(['after', 'every', 'every'])
  expect(clock.size()).toBe(0)
})

test('a cancelled after never fires, and dispose stops every pending timer', () => {
  const clock = manualSchedule()
  const system = createSystemApi({ cwd: () => '/', schedule: clock.schedule })
  const fired: string[] = []
  system.clock.after(10, () => fired.push('cancelled')).cancel()
  system.clock.every(10, () => fired.push('disposed'))
  system.dispose()
  clock.tick()
  expect(fired).toEqual([])
})

test('a timer callback that throws or rejects is reported, never left unhandled', async () => {
  const clock = manualSchedule()
  const errors: string[] = []
  const system = createSystemApi({
    cwd: () => '/',
    schedule: clock.schedule,
    onTimerError: (call, error) => errors.push(`${call}: ${(error as Error).message}`),
  })
  system.clock.after(10, () => {
    throw new Error('sync')
  })
  const tick = system.clock.every(10, async () => {
    throw new Error('async')
  })
  expect(() => clock.tick()).not.toThrow()
  await flush()
  await flush()
  tick.cancel()
  expect(errors.sort()).toEqual(['clock.after: sync', 'clock.every: async'])
})

test('clock.every fires at most every 100 ms, and a mod holds at most 100 timers', async () => {
  const intervals: number[] = []
  const clock = manualSchedule()
  const system = createSystemApi({
    cwd: () => '/',
    schedule: (fire, ms, repeat) => (intervals.push(ms), clock.schedule(fire, ms, repeat)),
  })
  system.clock.every(1, () => {})
  system.clock.every(0, () => {})
  system.clock.every(250, () => {})
  expect(intervals).toEqual([MIN_EVERY_MS, MIN_EVERY_MS, 250])
  for (let i = intervals.length; i < MAX_TIMERS; i++) system.clock.after(10, () => {})
  expect(() => system.clock.every(100, () => {})).toThrow('at most 100 timers')
  await expect(system.clock.sleep(10)).rejects.toThrow('at most 100 timers')
  // A timer that fired, or was cancelled, leaves room for another.
  clock.tick()
  expect(() => system.clock.after(10, () => {}).cancel()).not.toThrow()
  system.dispose()
})
