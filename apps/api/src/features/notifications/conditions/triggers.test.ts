import { afterEach, describe, expect, it } from 'bun:test'

import type { TriggerRecord } from '../../triggers/contracts'
import { createWakeDelivery } from '../../triggers/delivery'
import { flush, triggerHarness } from '../../triggers/test-harness'
import { createTriggerConditions, createWakeNotices, FAILING_STREAK } from './triggers'
import {
  createTestJournal,
  openRows,
  TEST_USER as U,
  type TestJournal,
} from './testing/test-journal'

const journals: TestJournal[] = []
afterEach(async () => {
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

async function journal() {
  const test = await createTestJournal()
  journals.push(test)
  return test
}

const loop = (over: Partial<TriggerRecord> = {}): TriggerRecord => ({
  id: 'T1',
  userId: U,
  sessionId: 'S1',
  owner: { kind: 'agent', agentId: 'lead' },
  action: 'loop',
  kind: 'cron',
  state: 'armed',
  holdReason: null,
  endReason: null,
  spec: {},
  payload: { prompt: 'check the build' },
  nextDueAt: null,
  fireSeq: 1,
  fireCount: 1,
  lastFiredAt: null,
  lastStatus: 'error',
  lastError: 'boom',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

describe('a loop that keeps failing', () => {
  it('is raised at the streak threshold, once, and settled by the next success', async () => {
    const test = await journal()
    const triggers = createTriggerConditions(test.journal)
    triggers.fireSettled(loop(), { ok: false, streak: 1, error: 'boom' })
    expect(await openRows(test)).toEqual([])
    triggers.fireSettled(loop(), { ok: false, streak: FAILING_STREAK, error: 'boom' })
    triggers.fireSettled(loop(), { ok: false, streak: FAILING_STREAK + 1, error: 'other words' })
    const open = await openRows(test)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      title: 'Could not run a scheduled loop',
      origin: { kind: 'session', sessionId: 'S1' },
    })

    triggers.fireSettled(loop(), { ok: true, streak: 0 })
    expect(await openRows(test)).toEqual([])
    triggers.fireSettled(loop(), { ok: false, streak: FAILING_STREAK, error: 'boom' })
    expect(await openRows(test)).toMatchObject([{ occurrenceCount: 2 }])
  })

  it('is retired when the loop ends, and a non-loop trigger is never reported', async () => {
    const test = await journal()
    const triggers = createTriggerConditions(test.journal)
    triggers.fireSettled(loop(), { ok: false, streak: 5, error: 'boom' })
    triggers.loopEnded(U, 'T1')
    triggers.fireSettled(loop({ id: 'M1', action: 'monitor' }), { ok: false, streak: 5 })
    const rows = [...(await test.rows()).values()]
    expect(rows.map((row) => [row.state, row.settleReason])).toEqual([['settled', 'cancelled']])
  })

  it('hears each fire’s streak from the engine, a success resetting it', async () => {
    const h = await triggerHarness()
    try {
      const seen: Array<[boolean, number]> = []
      const engine = h.engine({
        onFireSettled: (_t, result) => seen.push([result.ok, result.streak]),
      })
      const armed = await h.arm(engine, 'cron', { cron: '* * * * *', timeZone: 'UTC' })
      if ('error' in armed) throw new Error(armed.error)
      const fireAt = async (iso: string, ok: boolean) => {
        await h.advanceTo(iso, engine)
        h.fires.at(-1)!.settle(ok ? { ok } : { ok, error: 'down' })
        await flush()
      }
      await fireAt('2026-09-23T10:01:00.000Z', false)
      await fireAt('2026-09-23T10:02:00.000Z', false)
      await fireAt('2026-09-23T10:04:00.000Z', true)
      expect(seen).toEqual([
        [false, 1],
        [false, 2],
        [true, 0],
      ])
    } finally {
      await h.close()
    }
  })
})

describe('what a loop row offers', () => {
  it('a failing loop and a stranded one both come from the loop and open its chat', async () => {
    const test = await journal()
    const triggers = createTriggerConditions(test.journal)
    triggers.fireSettled(loop(), { ok: false, streak: FAILING_STREAK, error: 'boom' })
    triggers.routeStranded(loop())
    const open = await openRows(test)
    expect(open.map((row) => row.title).sort()).toEqual([
      'A scheduled loop has no model to run on',
      'Could not run a scheduled loop',
    ])
    for (const row of open) {
      expect(row).toMatchObject({
        origin: { kind: 'session', sessionId: 'S1', projectId: null, label: 'Loop' },
        actions: [
          {
            id: 'open-session',
            label: 'Open chat',
            kind: 'navigate',
            target: { kind: 'session', sessionId: 'S1', projectId: null },
            available: true,
          },
        ],
      })
    }
  })
})

describe('a wake that did not land', () => {
  const request = { userId: U, sessionId: 'S1', content: 'hi', source: 'external' as const }

  it('is one error row per delivery, however often the same fire is retried', async () => {
    const test = await journal()
    const wakes = createWakeDelivery({
      wake: async () => ({ delivered: false, missed: 'unreadable', detail: 'SQLITE_BUSY' }),
      logger: { warn: () => {} },
      onUndelivered: createWakeNotices(test.journal),
    })
    wakes.send({ ...request, deliveryKey: 'trg:T1:3' }, 'loop T1')
    wakes.send({ ...request, deliveryKey: 'trg:T1:3' }, 'loop T1')
    await flush()
    const open = await openRows(test)
    expect(open.map((row) => [row.key, row.severity, row.body, row.condition])).toEqual([
      ['delivery:trg%3AT1%3A3', 'error', 'loop T1 — SQLITE_BUSY', false],
    ])
  })

  it('says nothing for a chat that is gone, and folds keyless repeats into one row', async () => {
    const test = await journal()
    let answer: { delivered: false; missed: string } = { delivered: false, missed: 'gone' }
    const wakes = createWakeDelivery({
      wake: async () => answer,
      logger: { warn: () => {} },
      onUndelivered: createWakeNotices(
        test.journal,
        (() => {
          let clock = 0
          return () => ++clock
        })(),
      ),
    })
    wakes.send(request, 'plugin monitor ci/builds')
    await flush()
    expect(await openRows(test)).toEqual([])
    answer = { delivered: false, missed: 'not-chat' }
    wakes.send(request, 'plugin monitor ci/builds')
    wakes.send(request, 'plugin monitor ci/builds')
    await flush()
    expect(await openRows(test)).toMatchObject([{ severity: 'warning', occurrenceCount: 2 }])
  })
})
