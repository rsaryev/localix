import { describe, expect, test } from 'bun:test'
import type { Transaction } from 'kysely'
import { createBatchWriter } from './batch-writer'

type Outcome = { result: string } | { error: unknown }

/** A transaction that records which jobs committed together; a job named `poison` throws. */
function harness() {
  const commits: string[][] = []
  const outcomes: Array<[string, Outcome]> = []
  const logged: string[] = []
  const writer = createBatchWriter<unknown, string, string>({
    transaction: async (run) => {
      const pending: string[] = []
      const result = await run(pending as unknown as Transaction<unknown>)
      commits.push(pending)
      return result
    },
    apply: async (trx, job) => {
      if (job === 'poison') throw new Error('bad row')
      ;(trx as unknown as string[]).push(job)
      return `wrote ${job}`
    },
    settled: (job, outcome) => outcomes.push([job, outcome]),
    log: (event) => logged.push(event),
    failureEvent: 'test.write_failed',
  })
  return { writer, commits, outcomes, logged }
}

describe('batch writer', () => {
  test('jobs queued in one tick commit in one transaction, in order, reported after commit', async () => {
    const h = harness()
    h.writer.enqueue('a')
    h.writer.enqueue('b')
    expect(h.outcomes).toEqual([])
    await h.writer.flush()
    expect(h.commits).toEqual([['a', 'b']])
    expect(h.outcomes).toEqual([
      ['a', { result: 'wrote a' }],
      ['b', { result: 'wrote b' }],
    ])
  })

  test('a poisoned job loses only itself', async () => {
    const h = harness()
    h.writer.enqueue('a')
    h.writer.enqueue('poison')
    h.writer.enqueue('c')
    await h.writer.flush()
    expect(h.commits).toEqual([['a'], ['c']])
    expect(h.outcomes.map(([job, outcome]) => [job, 'error' in outcome])).toEqual([
      ['a', false],
      ['poison', true],
      ['c', false],
    ])
    expect(h.logged).toEqual(['test.write_failed'])
  })

  test('closed, it commits what is queued and takes nothing more', async () => {
    const h = harness()
    h.writer.enqueue('a')
    await h.writer.close()
    expect(h.writer.enqueue('late')).toBe(false)
    expect(h.commits).toEqual([['a']])
  })
})
