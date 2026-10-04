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

/** Simulate the process dying: a fresh engine over the same database, deadlines forgotten. */
async function restart() {
  h.deadlines.clear()
  const engine = h.engine()
  await engine.hydrate()
  await engine.start()
  return engine
}

describe('a restart', () => {
  test('a trigger that died mid-fire fires ONCE when its advanced slot has passed, not twice', async () => {
    const before = h.engine()
    const trigger = armed(await h.arm(before, 'cron', { cron: '*/5 * * * *', timeZone: 'UTC' }))
    await h.advanceTo('2026-09-23T10:05:00.000Z', before)
    expect(h.fires).toHaveLength(1) // …and the process dies before it settles.

    h.clock.ms = Date.parse('2026-09-23T12:00:00.000Z') // two hours of downtime
    const after = await restart()
    expect(after.get(trigger.id)).toMatchObject({
      state: 'armed',
      nextDueAt: '2026-09-23T10:10:00.000Z',
    })
    await h.advanceTo('2026-09-23T12:00:00.000Z', after)
    // One catch-up for the whole downtime — then the next slot from now, not a replay.
    expect(h.fires).toHaveLength(2)
    expect(after.get(trigger.id)!.nextDueAt).toBe('2026-09-23T12:05:00.000Z')
  })

  test('a busy hold is re-asked: busy was the dead process', async () => {
    const before = h.engine()
    const trigger = armed(await h.arm(before, 'delay', { delaySeconds: 60 }))
    h.setGate({ hold: 'busy' })
    await h.advanceTo('2026-09-23T10:01:00.000Z', before)
    expect(before.get(trigger.id)?.state).toBe('held')

    h.setGate(null)
    const after = await restart()
    expect(after.get(trigger.id)).toMatchObject({ state: 'armed', holdReason: null })
    await h.advanceTo('2026-09-23T10:01:00.000Z', after)
    expect(h.fires.map((fire) => fire.id)).toEqual([trigger.id])
  })

  test('a trigger whose action this build no longer registers is ENDED, not left looking armed', async () => {
    const before = h.engine()
    const trigger = armed(await h.arm(before, 'delay', {}))
    await h.db
      .updateTable('triggers')
      .set({ action: 'retired' })
      .where('id', '=', trigger.id)
      .execute()

    const after = await restart()
    expect(after.get(trigger.id)).toBeUndefined()
    expect(
      await h.db.selectFrom('triggers').select(['state', 'end_reason']).executeTakeFirstOrThrow(),
    ).toEqual({ state: 'ended', end_reason: 'unsupported' })
  })

  test('an ended trigger older than the retention is pruned; a recent one is kept to read', async () => {
    const engine = h.engine()
    const old = armed(await h.arm(engine, 'delay', {}))
    const recent = armed(await h.arm(engine, 'delay', {}))
    await engine.end(old.id, 'cancelled')
    h.clock.ms += 8 * 24 * 60 * 60 * 1000
    await engine.end(recent.id, 'cancelled')
    await flush()

    await restart()
    const left = await h.db.selectFrom('triggers').select('id').execute()
    expect(left.map((row) => row.id)).toEqual([recent.id])
  })

  test('nothing fires before start: hydrate sets no deadline', async () => {
    const before = h.engine()
    armed(await h.arm(before, 'delay', { delaySeconds: 60 }))
    h.deadlines.clear()
    const after = h.engine()
    await after.hydrate()
    expect(h.deadlines.size).toBe(0)
  })
})
