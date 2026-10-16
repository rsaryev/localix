import { expect, spyOn, test } from 'bun:test'
import { AgentSessionsService } from './service'
import { CORRELATE_ATTEMPT_DELAYS_MS } from './live/correlate'

type Timer = ReturnType<typeof setTimeout>
interface SchedulingInternals {
  timers: Set<Timer>
  scheduleCorrelation(terminalId: string, attempt?: number): void
  tryCorrelate(terminalId: string): Promise<boolean>
}

async function withTimers(
  run: (fixture: {
    service: AgentSessionsService
    internals: SchedulingInternals
    pending: { handle: Timer; fire: () => void }[]
    delays: (number | undefined)[]
    cleared: unknown[]
  }) => Promise<void>,
) {
  const service = new AgentSessionsService('.', () => {}, { env: {}, homeDir: '.' })
  const internals = service as unknown as SchedulingInternals
  const pending: { handle: Timer; fire: () => void }[] = []
  const delays: (number | undefined)[] = []
  const cleared: unknown[] = []
  const fakeTimeout = ((callback: () => void, delay?: number) => {
    const handle = { index: pending.length } as unknown as Timer
    pending.push({ handle, fire: () => callback() })
    delays.push(delay)
    return handle
  }) as typeof setTimeout
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(fakeTimeout)
  const clear = spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => {
    cleared.push(handle)
  })
  try {
    await run({ service, internals, pending, delays, cleared })
  } finally {
    service.shutdown()
    timeout.mockRestore()
    clear.mockRestore()
  }
}

test('correlation retries use every delay and retire the previous timer before trying', async () => {
  await withTimers(async ({ internals, pending, delays }) => {
    const calls: string[] = []
    internals.tryCorrelate = async (terminalId) => {
      expect(internals.timers.size).toBe(0)
      calls.push(terminalId)
      return false
    }
    internals.scheduleCorrelation('terminal')
    for (let i = 0; i < CORRELATE_ATTEMPT_DELAYS_MS.length; i++) {
      expect(internals.timers.has(pending[i]!.handle)).toBe(true)
      pending[i]!.fire()
      await Promise.resolve()
    }
    expect(delays).toEqual([...CORRELATE_ATTEMPT_DELAYS_MS])
    expect(calls).toEqual(CORRELATE_ATTEMPT_DELAYS_MS.map(() => 'terminal'))
    expect(internals.timers.size).toBe(0)
    expect(pending).toHaveLength(CORRELATE_ATTEMPT_DELAYS_MS.length)
  })
})

test('a successful attempt stops retries and uses the current correlator at firing time', async () => {
  await withTimers(async ({ internals, pending }) => {
    let staleCalls = 0
    internals.tryCorrelate = async () => {
      staleCalls++
      return false
    }
    internals.scheduleCorrelation('terminal')
    const calls: string[] = []
    internals.tryCorrelate = async (terminalId) => {
      calls.push(terminalId)
      return true
    }
    pending[0]!.fire()
    await Promise.resolve()
    expect(staleCalls).toBe(0)
    expect(calls).toEqual(['terminal'])
    expect(pending).toHaveLength(1)
    expect(internals.timers.size).toBe(0)
  })
})

test('shutdown clears every pending correlation timer', async () => {
  await withTimers(async ({ service, internals, pending, cleared }) => {
    internals.scheduleCorrelation('first')
    internals.scheduleCorrelation('second')
    expect(internals.timers.size).toBe(2)
    service.shutdown()
    expect(cleared).toEqual(pending.map(({ handle }) => handle))
    expect(internals.timers.size).toBe(0)
  })
})
