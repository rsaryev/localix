import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { TriggerRecord } from './contracts'
import { flush, triggerHarness } from './test-harness'

type Harness = Awaited<ReturnType<typeof triggerHarness>>
let h: Harness

beforeEach(async () => {
  h = await triggerHarness()
})
afterEach(() => h.close())

const everyFive = { cron: '*/5 * * * *', timeZone: 'UTC' }
const armed = (result: TriggerRecord | { error: string }) => {
  if ('error' in result) throw new Error(result.error)
  return result
}
const stored = (id: string) =>
  h.db.selectFrom('triggers').selectAll().where('id', '=', id).executeTakeFirstOrThrow()

describe('the fire cycle', () => {
  test('a cron fires at its slot, advancing BEFORE delivery so a slow fire cannot fire twice', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'cron', everyFive))
    expect(h.deadlines.get(trigger.id)).toBe(Date.parse('2026-09-23T10:05:00.000Z'))

    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    expect(h.fires.map((fire) => fire.deliveryKey)).toEqual([`trg:${trigger.id}:1`])
    // Still delivering, already pointing at the next slot, and with no deadline of its own:
    // the settle re-arms it.
    expect(await stored(trigger.id)).toMatchObject({
      state: 'firing',
      next_due_at: '2026-09-23T10:10:00.000Z',
    })
    expect(h.deadlines.has(trigger.id)).toBe(false)
    await h.advanceTo('2026-09-23T10:06:00.000Z', engine)
    expect(h.fires).toHaveLength(1)

    h.fires[0]!.settle({ ok: true })
    await flush()
    expect(await stored(trigger.id)).toMatchObject({
      state: 'armed',
      last_status: 'ok',
      fire_count: 1,
    })
    expect(h.deadlines.get(trigger.id)).toBe(Date.parse('2026-09-23T10:10:00.000Z'))
  })

  test('a busy session: a cron slot is given up, a delay is held with no deadline until idle', async () => {
    const engine = h.engine()
    const cron = armed(await h.arm(engine, 'cron', everyFive))
    const delay = armed(await h.arm(engine, 'delay', { delaySeconds: 120 }))
    h.setGate({ hold: 'busy' })

    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    expect(h.fires).toEqual([])
    expect(engine.get(cron.id)).toMatchObject({
      state: 'armed',
      nextDueAt: '2026-09-23T10:10:00.000Z',
    })
    expect(engine.get(delay.id)).toMatchObject({ state: 'held', holdReason: 'busy' })
    // No polling: a busy hold waits for the session, not for a clock.
    expect(h.deadlines.has(delay.id)).toBe(false)

    h.setGate(null)
    engine.poke('s1')
    await flush()
    expect(h.fires.map((fire) => fire.id)).toEqual([delay.id])
  })

  test('a rate-limited hold is PERSISTED, so a restart does not fire into the exhausted quota', async () => {
    const engine = h.engine()
    const delay = armed(await h.arm(engine, 'delay', { delaySeconds: 60 }))
    h.setGate({ hold: 'rate-limited', untilMs: Date.parse('2026-09-23T10:30:00.000Z') })
    await h.advanceTo('2026-09-23T10:01:00.000Z', engine)
    expect(await stored(delay.id)).toMatchObject({
      state: 'held',
      hold_reason: 'rate-limited',
      next_due_at: '2026-09-23T10:30:00.000Z',
    })

    h.deadlines.clear()
    const restarted = h.engine()
    await restarted.hydrate()
    await restarted.start()
    expect(h.deadlines.get(delay.id)).toBe(Date.parse('2026-09-23T10:30:00.000Z'))
    await h.advanceTo('2026-09-23T10:10:00.000Z', restarted)
    expect(h.fires).toEqual([])
  })

  test('a failing cron backs off, doubling, and one success restores its cadence', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'cron', { cron: '* * * * *', timeZone: 'UTC' }))
    const failAt = async (iso: string) => {
      await h.advanceTo(iso, engine)
      h.fires.at(-1)!.settle({ ok: false, error: 'provider gone' })
      await flush()
    }
    await failAt('2026-09-23T10:01:00.000Z')
    // One failure costs nothing at a one-minute cadence: the backoff equals the next slot.
    expect(engine.get(trigger.id)!.nextDueAt).toBe('2026-09-23T10:02:00.000Z')
    await failAt('2026-09-23T10:02:00.000Z')
    expect(engine.get(trigger.id)!.nextDueAt).toBe('2026-09-23T10:04:00.000Z')
    expect(engine.get(trigger.id)).toMatchObject({
      lastStatus: 'error',
      lastError: 'provider gone',
    })

    await h.advanceTo('2026-09-23T10:04:00.000Z', engine)
    h.fires.at(-1)!.settle({ ok: true })
    await flush()
    expect(engine.get(trigger.id)!.nextDueAt).toBe('2026-09-23T10:05:00.000Z')
  })

  test('a SKIPPED fire is not an outcome: the status stands and the streak is untouched', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'cron', everyFive))
    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    h.fires[0]!.settle({ ok: true, skipped: true })
    await flush()
    expect(engine.get(trigger.id)).toMatchObject({
      lastStatus: null,
      nextDueAt: '2026-09-23T10:10:00.000Z',
    })
  })

  test('a delay re-arms at its watchdog after every fire — it is never parked', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'delay', { delaySeconds: 300 }))
    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    h.fires[0]!.settle({ ok: false, error: 'the run failed' })
    await flush()
    // The failure the old engine parked forever: here it comes back at the same pace.
    expect(engine.get(trigger.id)).toMatchObject({
      state: 'armed',
      nextDueAt: '2026-09-23T10:10:00.000Z',
    })
  })

  test('a reschedule during a fire survives that fire settling', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'delay', { delaySeconds: 300 }))
    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    await engine.update(trigger.id, { spec: { delaySeconds: 60 } })
    h.fires[0]!.settle({ ok: true })
    await flush()
    expect(engine.get(trigger.id)!.nextDueAt).toBe('2026-09-23T10:06:00.000Z')
    expect(h.deadlines.get(trigger.id)).toBe(Date.parse('2026-09-23T10:06:00.000Z'))
  })

  test('a trigger ended during its fire stays ended — the late outcome lands nowhere', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'cron', everyFive))
    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    await engine.end(trigger.id, 'cancelled')
    h.fires[0]!.settle({ ok: false, error: 'aborted' })
    await flush()
    expect(await stored(trigger.id)).toMatchObject({
      state: 'ended',
      end_reason: 'cancelled',
      last_status: null,
    })
    expect(engine.get(trigger.id)).toBeUndefined()
  })

  test('an end the store refused is reported, and the trigger keeps its deadline', async () => {
    const engine = h.engine({
      repo: {
        ...h.repo,
        transition: async () => {
          throw new Error('SQLITE_BUSY')
        },
      },
    })
    const trigger = armed(await h.arm(engine, 'cron', everyFive))
    expect(await engine.end(trigger.id, 'cancelled')).toEqual({
      error: `The trigger store could not be written, so ending trigger ${trigger.id} did not take effect.`,
    })
    expect(engine.get(trigger.id)?.state).toBe('armed')
    expect(h.deadlines.has(trigger.id)).toBe(true)
  })

  test('fireNow is an extra fire: it keeps the slot and refuses to overlap a running fire', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'cron', everyFive))
    armed(await engine.fireNow(trigger.id))
    expect(engine.get(trigger.id)!.nextDueAt).toBe('2026-09-23T10:05:00.000Z')
    expect(await engine.fireNow(trigger.id)).toEqual({
      error: `Trigger ${trigger.id} is firing right now.`,
    })
  })

  test('a cron is read in the zone it was written in, across a DST change', async () => {
    const engine = h.engine()
    const nine = armed(
      await h.arm(engine, 'cron', { cron: '0 9 * * *', timeZone: 'Europe/Berlin' }),
    )
    expect(nine.nextDueAt).toBe('2026-09-24T07:00:00.000Z') // CEST, UTC+2
    h.clock.ms = Date.parse('2026-10-26T12:00:00.000Z')
    const winter = armed(
      await h.arm(engine, 'cron', { cron: '0 9 * * *', timeZone: 'Europe/Berlin' }),
    )
    expect(winter.nextDueAt).toBe('2026-10-27T08:00:00.000Z') // CET, UTC+1
  })

  test('a schedule with no next moment ends rather than idling unseen', async () => {
    const engine = h.engine()
    expect(await h.arm(engine, 'cron', { cron: '0 0 30 2 *', timeZone: 'UTC' })).toEqual({
      error: 'That schedule never fires.',
    })
  })
})
