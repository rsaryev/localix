import { describe, expect, test } from 'bun:test'
import type { DecisionRequest } from '@localixai/agent/runtime'
import type { DecisionAsk } from '@localixai/plugin-sdk/backend'
import type { ResolvedDecider } from './models'
import { createDecisionService, type DecisionRecord } from './service'

const MODEL = 'provider/decider'

const ask: DecisionAsk = {
  state: { transcript: [{ author: 'person', text: 'May we reuse these photos?' }] },
  questions: {
    next: { type: 'choice', instructions: 'Who?', criteria: { lawyer: 'Law.', design: 'Looks.' } },
  },
}
const options = { purpose: 'routing', sessionId: 's1' }

function service(decide?: ResolvedDecider['decide'] | null) {
  const asked: DecisionRequest[] = []
  const ledger: unknown[] = []
  const records: DecisionRecord[] = []
  const decider: ResolvedDecider | null =
    decide === null
      ? null
      : {
          providerConnectionId: 'or-connection',
          providerId: 'openrouter',
          decide: (request) => {
            asked.push(request)
            return (
              decide?.(request) ??
              Promise.resolve({
                answers: {
                  next: { type: 'choice', choice: 'lawyer', probabilities: { lawyer: 0.9 } },
                },
                usage: { input: 400, output: 30 } as never,
              })
            )
          },
        }
  const decisions = createDecisionService({
    backends: [{ model: MODEL, resolve: async () => decider }],
    recordUsage: (entry) => ledger.push(entry),
    log: (record) => records.push(record),
  })
  return { decisions, asked, ledger, records }
}

describe('the decision service', () => {
  test('answers with the default model, records the spend, logs without the state', async () => {
    const { decisions, ledger, records } = service()
    expect(await decisions.available('u1')).toEqual({ model: MODEL })
    const outcome = await decisions.decide('u1', ask, { ...options, usageKind: 'routing' })
    expect(outcome).toMatchObject({
      status: 'answered',
      model: MODEL,
      answers: { next: { choice: 'lawyer' } },
    })
    expect(ledger).toEqual([
      expect.objectContaining({
        userId: 'u1',
        sessionId: 's1',
        model: MODEL,
        providerConnectionId: 'or-connection',
        kind: 'routing',
      }),
    ])
    expect(records).toEqual([
      expect.objectContaining({ purpose: 'routing', status: 'answered', questions: ['next'] }),
    ])
    expect(JSON.stringify(records)).not.toContain('photos')
  })

  test('spend defaults to the decision row', async () => {
    const { decisions, ledger } = service()
    await decisions.decide('u1', ask, options)
    expect(ledger).toEqual([expect.objectContaining({ kind: 'decision' })])
  })

  test('without a connection serving the model: unavailable, nothing asked', async () => {
    const { decisions, asked, records } = service(null)
    expect(await decisions.available('u1')).toBeNull()
    expect(await decisions.decide('u1', ask, options)).toMatchObject({ status: 'unavailable' })
    expect(asked).toEqual([])
    expect(records[0]).toMatchObject({ status: 'unavailable' })
  })

  test('a provider failure is an outcome, never a throw', async () => {
    const { decisions } = service(async () => {
      throw new Error('503')
    })
    expect(await decisions.decide('u1', ask, options)).toMatchObject({
      status: 'failed',
      model: MODEL,
    })
  })

  test('a slow answer is cut at the deadline and the call is aborted', async () => {
    let aborted = false
    const { decisions } = service(
      (request) =>
        new Promise((_resolve, reject) =>
          request.signal?.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          }),
        ),
    )
    const started = Date.now()
    const outcome = await decisions.decide('u1', ask, { ...options, deadlineMs: 30 })
    expect(outcome.status).toBe('deadline')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(aborted).toBe(true)
  })

  test('the caller’s signal cancels, before and during the call', async () => {
    const { decisions, asked } = service(() => new Promise(() => {}))
    const before = new AbortController()
    before.abort()
    expect(await decisions.decide('u1', ask, { ...options, signal: before.signal })).toMatchObject({
      status: 'cancelled',
    })
    expect(asked).toEqual([])

    const during = new AbortController()
    const pending = decisions.decide('u1', ask, { ...options, signal: during.signal })
    await Bun.sleep(5)
    during.abort()
    expect(await pending).toMatchObject({ status: 'cancelled' })
    expect(asked[0]!.signal?.aborted).toBe(true)
  })

  test('a backend that throws cannot answer; the next listed one does', async () => {
    const decisions = createDecisionService({
      backends: [
        {
          model: 'first',
          resolve: async () => {
            throw new Error('catalog down')
          },
        },
        { model: 'second', resolve: async () => null },
        {
          model: 'third',
          resolve: async () => ({
            providerConnectionId: null,
            providerId: 'local',
            decide: async () => ({ answers: {} }),
          }),
        },
      ],
      recordUsage: () => {},
    })
    expect(await decisions.available('u1')).toEqual({ model: 'third' })
    expect(await decisions.decide('u1', ask, options)).toMatchObject({
      status: 'answered',
      model: 'third',
    })
  })

  test('no backend can answer: unavailable', async () => {
    const decisions = createDecisionService({
      backends: [{ model: 'first', resolve: async () => null }],
      recordUsage: () => {},
    })
    expect(await decisions.available('u1')).toBeNull()
    expect(await decisions.decide('u1', ask, options)).toMatchObject({ status: 'unavailable' })
  })
})
