/**
 * The stage engine's three safety properties, each written as the failure it prevents.
 */
import { describe, expect, test } from 'bun:test'

import { runHistoryStages, pipelineSavings } from './pipeline'
import { appendStage, mapStage, type HistoryStage, type StageContext } from './stage'

type Msg = { id: string; text: string }

const ctx = (): StageContext => ({
  budgetTokens: 1000,
  // One token per character keeps the arithmetic in the test readable.
  estimate: (messages) => (messages as Msg[]).reduce((n, m) => n + m.text.length, 0),
  signal: new AbortController().signal,
})

const seed: Msg[] = [
  { id: 'a', text: 'aaaa' },
  { id: 'b', text: 'bbbb' },
]

const shrink: HistoryStage<Msg> = {
  name: 'shrink',
  shrinksOnly: true,
  run: (messages) => ({ messages: messages.map((m) => ({ ...m, text: m.text.slice(0, 2) })) }),
}

describe('runHistoryStages', () => {
  test('stages compose in order, each seeing the previous output', async () => {
    const result = await runHistoryStages(
      seed,
      [
        mapStage<Msg>('upper', (m) => ({ ...m, text: m.text.toUpperCase() })),
        mapStage<Msg>('trim', (m) => ({ ...m, text: m.text.slice(0, 1) })),
      ],
      ctx(),
    )
    expect(result.messages.map((m) => m.text)).toEqual(['A', 'B'])
    expect(result.reports.map((r) => r.stage)).toEqual(['upper', 'trim'])
  })

  test('an advisory stage that throws is skipped, and the turn keeps its input', async () => {
    // The failure this prevents: a bug in an image downscale costing the whole turn.
    const boom: HistoryStage<Msg> = {
      name: 'boom',
      advisory: true,
      run: () => {
        throw new Error('parser bug')
      },
    }
    const result = await runHistoryStages(seed, [boom], ctx())
    expect(result.messages).toBe(seed)
    expect(result.reports[0]).toMatchObject({ stage: 'boom', status: 'failed' })
  })

  test('a LOAD-BEARING stage that throws stops the turn', async () => {
    // The failure this prevents: a broken boundary cut silently re-sending cleared history.
    const cut: HistoryStage<Msg> = {
      name: 'boundary-cut',
      run: () => {
        throw new Error('boundary unreadable')
      },
    }
    await expect(runHistoryStages(seed, [cut], ctx())).rejects.toThrow('boundary unreadable')
  })

  test('a shrinking stage that grows the wire is discarded', async () => {
    const bloat: HistoryStage<Msg> = {
      name: 'bloat',
      shrinksOnly: true,
      run: (messages) => ({ messages: messages.map((m) => ({ ...m, text: m.text.repeat(4) })) }),
    }
    const result = await runHistoryStages(seed, [bloat], ctx())
    expect(result.messages).toBe(seed)
    expect(result.reports[0]).toMatchObject({ status: 'discarded_grew', tokensAfter: 8 })
  })

  test('a shrinking stage may add a small marker while removing more', async () => {
    // The allowance exists for exactly this: an elision that costs a pointer and saves a body.
    const pointer: HistoryStage<Msg> = {
      name: 'pointer',
      shrinksOnly: true,
      run: (messages) => ({
        messages: messages.map((m) => (m.id === 'a' ? { ...m, text: 'x' } : m)),
      }),
    }
    const result = await runHistoryStages(seed, [pointer], ctx())
    expect(result.reports[0]?.status).toBe('applied')
    expect(result.messages[0]?.text).toBe('x')
  })

  test('an unchanged stage reports noop and preserves references', async () => {
    const result = await runHistoryStages(seed, [mapStage<Msg>('identity', (m) => m)], ctx())
    expect(result.reports[0]).toMatchObject({ status: 'noop', changedCount: 0 })
    expect(result.messages[0]).toBe(seed[0])
  })

  test('drops are reported with their reason', async () => {
    const cut: HistoryStage<Msg> = {
      name: 'cut',
      run: (messages) => ({
        messages: messages.slice(1),
        dropped: [{ reason: 'boundary', messageId: 'a' }],
      }),
    }
    const result = await runHistoryStages(seed, [cut], ctx())
    expect(result.reports[0]?.dropped).toEqual([{ reason: 'boundary', messageId: 'a' }])
    expect(result.reports[0]?.status).toBe('applied')
  })

  test('an aborted signal stops the pipeline before the next stage', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const stageCtx = { ...ctx(), signal: aborted.signal }
    await expect(runHistoryStages(seed, [shrink], stageCtx)).rejects.toThrow()
  })

  test('savings are the distance between the first and last measurement', async () => {
    const result = await runHistoryStages(seed, [shrink], ctx())
    expect(pipelineSavings(result.reports)).toBe(4)
    expect(pipelineSavings([])).toBe(0)
  })
})

describe('stage helpers', () => {
  test('mapStage preserves the message count — the arity the offset accounting needs', async () => {
    const result = await runHistoryStages(
      seed,
      [mapStage<Msg>('rewrite', (m) => ({ ...m, text: '' }))],
      ctx(),
    )
    expect(result.messages).toHaveLength(seed.length)
  })

  test('appendStage adds at the end, or nothing at all', async () => {
    const withTail = await runHistoryStages(
      seed,
      [appendStage<Msg>('tail', () => ({ id: 'tail', text: 'runtime' }))],
      ctx(),
    )
    expect(withTail.messages[withTail.messages.length - 1]?.id).toBe('tail')

    const withoutTail = await runHistoryStages(
      seed,
      [appendStage<Msg>('tail', () => undefined)],
      ctx(),
    )
    expect(withoutTail.messages).toBe(seed)
    expect(withoutTail.reports[0]?.status).toBe('noop')
  })
})
