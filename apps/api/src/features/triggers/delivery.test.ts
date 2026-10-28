import { describe, expect, test } from 'bun:test'

import { createWakeDelivery, fireOutcomeOf, triggerWake, type WakeAnswer } from './delivery'

const request = { userId: 'u1', sessionId: 's1', content: 'hi', source: 'external' as const }
const delivery = (answer: () => Promise<WakeAnswer>) => {
  const warnings: Record<string, unknown>[] = []
  const wakes = createWakeDelivery({
    wake: answer,
    logger: { warn: (entry) => void warnings.push(entry) },
  })
  return { wakes, warnings }
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('the one wake delivery', () => {
  test('answers delivered | missed | failed, and never throws', async () => {
    expect(await delivery(async () => ({ delivered: true })).wakes.deliver(request)).toEqual({
      status: 'delivered',
    })
    expect(
      await delivery(async () => ({ delivered: false, missed: 'gone' })).wakes.deliver(request),
    ).toEqual({ status: 'missed', reason: 'gone' })
    // An unreadable store is the host failing, not an ordinary miss.
    expect(
      await delivery(async () => ({
        delivered: false,
        missed: 'unreadable',
        detail: 'SQLITE_BUSY',
      })).wakes.deliver(request),
    ).toEqual({ status: 'failed', detail: 'SQLITE_BUSY' })
    expect(
      await delivery(async () => {
        throw new Error('boom')
      }).wakes.deliver(request),
    ).toEqual({ status: 'failed', detail: 'boom' })
  })

  test('a detached wake that does not land is logged against its SUBJECT; one that lands is not', async () => {
    const missed = delivery(async () => ({ delivered: false, missed: 'not-chat' }))
    missed.wakes.send(request, 'plugin monitor ci/builds')
    await settle()
    expect(missed.warnings).toEqual([
      {
        event: 'wake.undelivered',
        subject: 'plugin monitor ci/builds',
        sessionId: 's1',
        source: 'external',
        missed: 'not-chat',
      },
    ])
    const landed = delivery(async () => ({ delivered: true }))
    landed.wakes.send(request, 'reaction')
    await settle()
    expect(landed.warnings).toEqual([])
  })

  test('a detached wake hands its outcome to the producer, so a standing arm can drop a gone session', async () => {
    const outcomes: unknown[] = []
    const gone = delivery(async () => ({ delivered: false, missed: 'gone' }))
    gone.wakes.send(request, 'plugin monitor ci/builds', (outcome) => outcomes.push(outcome))
    await settle()
    expect(outcomes).toEqual([{ status: 'missed', reason: 'gone' }])
    expect(gone.warnings).toHaveLength(1)
  })

  test('a wake no session was named for is logged as undelivered and woken nowhere', () => {
    let woken = 0
    const warnings: Record<string, unknown>[] = []
    const wakes = createWakeDelivery({
      wake: async () => {
        woken += 1
        return { delivered: true }
      },
      logger: { warn: (entry) => void warnings.push(entry) },
    })
    wakes.unaddressed('plugin monitor ci/builds', 'external')
    expect(woken).toBe(0)
    expect(warnings).toEqual([
      {
        event: 'wake.undelivered',
        subject: 'plugin monitor ci/builds',
        source: 'external',
        missed: 'no-session',
      },
    ])
  })

  test("a fire's wake is addressed to the agent that armed it and keyed by the fire", () => {
    const wake = triggerWake(
      { userId: 'u1', sessionId: 's1', owner: { kind: 'agent', agentId: 'qa' } },
      { content: 'x', source: 'bg-monitor', deliveryKey: 'trg:t1:3' },
    )
    expect(wake).toEqual({
      userId: 'u1',
      sessionId: 's1',
      content: 'x',
      source: 'bg-monitor',
      deliveryKey: 'trg:t1:3',
    })
    expect(fireOutcomeOf({ status: 'missed', reason: 'gone' })).toEqual({
      ok: false,
      error: 'wake missed: gone',
    })
  })
})
