import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { TriggerRecord } from './contracts'
import { flush, triggerHarness } from './test-harness'

type Harness = Awaited<ReturnType<typeof triggerHarness>>
let h: Harness

beforeEach(async () => {
  h = await triggerHarness()
})
afterEach(() => h.close())

const armed = (result: TriggerRecord | { error: string }) => {
  if ('error' in result) throw new Error(result.error)
  return result
}
const stored = (id: string) =>
  h.db.selectFrom('triggers').selectAll().where('id', '=', id).executeTakeFirstOrThrow()

describe('an event kind', () => {
  test('arms with no due time and no deadline — null is waiting for news, not exhausted', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'stream', {}))
    expect(trigger).toMatchObject({ state: 'armed', nextDueAt: null })
    expect(h.deadlines.has(trigger.id)).toBe(false)

    expect(await engine.emit(trigger.id, { line: 'a' })).toBeNull()
    expect(h.fires).toMatchObject([{ deliveryKey: `trg:${trigger.id}:1`, event: { line: 'a' } }])
    h.fires[0]!.settle({ ok: true })
    await flush()
    // Settled back to armed rather than ended for having no next moment.
    expect(engine.get(trigger.id)).toMatchObject({ state: 'armed', nextDueAt: null, fireCount: 1 })
  })

  test('two events are two fires IN ORDER, the second waiting for the first to settle', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'stream', {}))
    const first = engine.emit(trigger.id, { line: 'a' })
    const second = engine.emit(trigger.id, { line: 'b' })
    await first
    await flush()
    // The second has not fired over the first's delivery.
    expect(h.fires.map((fire) => fire.event)).toEqual([{ line: 'a' }])
    h.fires[0]!.settle({ ok: true })
    await second
    expect(h.fires.map((fire) => [fire.event, fire.deliveryKey])).toEqual([
      [{ line: 'a' }, `trg:${trigger.id}:1`],
      [{ line: 'b' }, `trg:${trigger.id}:2`],
    ])
  })

  test('the action ending a fire ends the trigger', async () => {
    const engine = h.engine()
    const trigger = armed(await h.arm(engine, 'stream', {}))
    await engine.emit(trigger.id, { exited: true })
    h.fires[0]!.settle({ ok: true, end: 'exited' })
    await flush()
    expect(engine.get(trigger.id)).toBeUndefined()
    expect(await stored(trigger.id)).toMatchObject({ state: 'ended', end_reason: 'exited' })
    expect(await engine.emit(trigger.id, { late: true })).toContain('not active')
  })

  test('a time kind still refuses a spec that never fires', async () => {
    const engine = h.engine()
    expect(await h.arm(engine, 'cron', { cron: 'not a cron', timeZone: 'UTC' })).toEqual({
      error: 'That schedule never fires.',
    })
  })
})

describe('a restart', () => {
  test('ENDS a stream, telling its owner once under the next fire key — then it is gone', async () => {
    const before = h.engine()
    const trigger = armed(await h.arm(before, 'stream', {}))
    await before.emit(trigger.id, { line: 'a' })
    h.fires[0]!.settle({ ok: true })
    await flush()

    const after = h.engine()
    await after.hydrate()
    // Not resumed: the process feeding it died with the old server.
    expect(after.get(trigger.id)).toBeUndefined()
    expect(h.notices).toEqual([])
    await after.start()
    expect(h.notices).toEqual([{ id: trigger.id, deliveryKey: `trg:${trigger.id}:2` }])
    expect(await stored(trigger.id)).toMatchObject({ state: 'ended', end_reason: 'restart' })

    // A second restart says nothing more.
    const third = h.engine()
    await third.hydrate()
    await third.start()
    expect(h.notices).toHaveLength(1)
  })

  test('RESUMES a poll from its row, due where it was', async () => {
    const before = h.engine()
    const trigger = armed(
      await h.arm(before, 'poll', { everySeconds: 30, expiresAt: '2026-09-23T11:00:00.000Z' }),
    )
    // Due at once: the thing waited for may already have happened.
    expect(h.deadlines.get(trigger.id)).toBe(Date.parse('2026-09-23T10:00:00.000Z'))
    await h.advanceTo('2026-09-23T10:00:00.000Z', before)
    h.fires[0]!.settle({ ok: true })
    await flush()

    h.deadlines.clear()
    const after = h.engine()
    await after.hydrate()
    await after.start()
    expect(after.get(trigger.id)).toMatchObject({
      state: 'armed',
      nextDueAt: '2026-09-23T10:00:30.000Z',
    })
    expect(h.deadlines.get(trigger.id)).toBe(Date.parse('2026-09-23T10:00:30.000Z'))
    expect(h.notices).toEqual([])
  })

  test("a poll's last interval ends ON its deadline, not an interval after it", async () => {
    const engine = h.engine()
    const trigger = armed(
      await h.arm(engine, 'poll', { everySeconds: 60, expiresAt: '2026-09-23T10:01:30.000Z' }),
    )
    await h.advanceTo('2026-09-23T10:00:00.000Z', engine)
    h.fires[0]!.settle({ ok: true })
    await flush()
    await h.advanceTo('2026-09-23T10:01:00.000Z', engine)
    expect(engine.get(trigger.id)!.nextDueAt).toBe('2026-09-23T10:01:30.000Z')
  })
})
